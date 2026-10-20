"use server";

import { createClient as createAdminClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export type ManagedUser = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "employee" | "manager";
};

type UserActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { supabase, user: null, error: "You must be signed in." };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profileError || profile?.role !== "admin") {
    return { supabase, user: null, error: "Only administrators can manage users." };
  }

  return { supabase, user, error: null };
}

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase server environment variables are not configured.");
  }

  return createAdminClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function getAllUsers(): Promise<UserActionResult<ManagedUser[]>> {
  try {
    const authorization = await requireAdmin();
    if (authorization.error) return { success: false, error: authorization.error };

    const { data: profiles, error } = await authorization.supabase
      .from("profiles")
      .select("id, name, role")
      .order("name", { ascending: true });

    if (error) return { success: false, error: error.message };

    const adminClient = getAdminClient();
    const { data: authUsers, error: authError } = await adminClient.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });

    if (authError) return { success: false, error: authError.message };

    const emails = new Map(authUsers.users.map((user) => [user.id, user.email ?? "-"]));
    const users = (profiles ?? []).map((profile) => ({
      id: profile.id,
      name: profile.name || "-",
      email: emails.get(profile.id) ?? "-",
      role: profile.role as ManagedUser["role"],
    }));

    return { success: true, data: users };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to fetch users.",
    };
  }
}

export async function adminCreateUser(
  email: string,
  password: string,
  name: string,
): Promise<UserActionResult<{ userId: string }>> {
  const trimmedEmail = email?.trim().toLowerCase() ?? "";
  const trimmedName = name?.trim() ?? "";

  if (!trimmedName) {
    return { success: false, error: "Full name is required." };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    return { success: false, error: "A valid email address is required." };
  }
  if (!password || password.length < 8) {
    return { success: false, error: "Password must be at least 8 characters long." };
  }

  try {
    // SECURITY: verify the currently signed-in user has the 'admin' role in profiles.
    const authorization = await requireAdmin();
    if (authorization.error) return { success: false, error: authorization.error };

    // Use the Supabase Admin Auth API (service role) so the admin's own session stays intact.
    const adminClient = getAdminClient();
    const { data: newUserData, error: createError } = await adminClient.auth.admin.createUser({
      email: trimmedEmail,
      password,
      email_confirm: true,
    });

    if (createError) return { success: false, error: createError.message };
    if (!newUserData?.user) return { success: false, error: "User creation failed." };

    // The database trigger already created the profiles row; set the provided name on it.
    const { error: profileError } = await adminClient
      .from("profiles")
      .update({ name: trimmedName })
      .eq("id", newUserData.user.id);

    if (profileError) return { success: false, error: profileError.message };

    revalidatePath("/dashboard/settings");
    return { success: true, data: { userId: newUserData.user.id } };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to create user.",
    };
  }
}

export async function updateUserRole(
  userId: string,
  newRole: string,
): Promise<UserActionResult<ManagedUser["role"]>> {
  if (!userId || !["admin", "manager", "employee"].includes(newRole)) {
    return { success: false, error: "A valid user and role are required." };
  }

  try {
    const authorization = await requireAdmin();
    if (authorization.error) return { success: false, error: authorization.error };

    const { error } = await authorization.supabase
      .from("profiles")
      .update({ role: newRole })
      .eq("id", userId);

    if (error) return { success: false, error: error.message };

    revalidatePath("/dashboard/settings");
    revalidatePath("/dashboard");
    return { success: true, data: newRole as ManagedUser["role"] };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to update user role.",
    };
  }
}

export async function removeUserAccess(
  userId: string,
): Promise<UserActionResult<{ userId: string }>> {
  if (!userId) return { success: false, error: "User ID is required." };

  try {
    const authorization = await requireAdmin();
    if (authorization.error) return { success: false, error: authorization.error };

    if (authorization.user?.id === userId) {
      return { success: false, error: "You cannot revoke your own admin access." };
    }

    const adminClient = getAdminClient();

    // Supabase Auth refuses to remove a user while that user owns Storage
    // objects. CRM avatars are stored below the user's profile ID, so delete
    // those files through the Storage API before deleting the Auth account.
    const folders = [userId];
    const avatarPaths: string[] = [];
    while (folders.length) {
      const path = folders.pop()!;
      for (let offset = 0; ; offset += 1000) {
        const { data: objects, error: listError } = await adminClient.storage
          .from("employee-avatars")
          .list(path, { limit: 1000, offset });
        if (listError) {
          return {
            success: false,
            error: `Could not prepare this user's avatar files for removal: ${listError.message}`,
          };
        }
        for (const object of objects ?? []) {
          if (object.id === null) folders.push(`${path}/${object.name}`);
          else avatarPaths.push(`${path}/${object.name}`);
        }
        if (!objects || objects.length < 1000) break;
      }
    }
    for (let index = 0; index < avatarPaths.length; index += 1000) {
      const { error: storageError } = await adminClient.storage
        .from("employee-avatars")
        .remove(avatarPaths.slice(index, index + 1000));
      if (storageError) {
        return {
          success: false,
          error: `Could not remove this user's avatar files: ${storageError.message}`,
        };
      }
    }

    const { error: authError } = await adminClient.auth.admin.deleteUser(userId);
    if (authError) {
      return {
        success: false,
        error: `CRM access was not fully removed because Supabase could not delete the sign-in account: ${authError.message}`,
      };
    }

    const { error: profileError } = await adminClient
      .from("profiles")
      .delete()
      .eq("id", userId);

    if (profileError) {
      return {
        success: false,
        error: `The Supabase sign-in account was deleted, but the CRM profile could not be cleaned up: ${profileError.message}`,
      };
    }

    revalidatePath("/dashboard/settings");
    revalidatePath("/dashboard");
    return { success: true, data: { userId } };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to revoke user access.",
    };
  }
}
