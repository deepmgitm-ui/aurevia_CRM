"use server";

import { revalidatePath } from "next/cache";

import type { EmployeeDirectoryEntry } from "@/app/actions/leads";
import { createClient } from "@/lib/supabase/server";

export type ProfileActionResult =
  | { success: true; name: string }
  | { success: false; error: string };

export type EmployeeProfileInput = {
  name: string;
  phone: string;
  email: string;
  gender: string;
  blood_group: string;
  emergency_contact: string;
  photo_url: string | null;
};

export type EmployeeProfileActionResult =
  | { success: true; profile: EmployeeDirectoryEntry }
  | { success: false; error: string };

function optionalText(value: string, label: string, maxLength: number): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "-") return null;
  if (trimmed.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  }
  return trimmed;
}

function isMissingSelfProfileMigration(message: string): boolean {
  return /update_my_employee_profile|function .* does not exist|could not find the function/i.test(message);
}

export async function updateProfileName(newName: string): Promise<ProfileActionResult> {
  const name = newName.trim();
  if (!name) return { success: false, error: "Name is required." };

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return { success: false, error: "You must be signed in to update your profile." };
    }

    const { error } = await supabase.from("profiles").update({ name }).eq("id", user.id);
    if (error) return { success: false, error: error.message };

    revalidatePath("/dashboard/settings");
    revalidatePath("/dashboard");
    return { success: true, name };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to update profile.",
    };
  }
}

/** Update only the signed-in user's approved, non-role profile fields. */
export async function updateMyEmployeeProfile(
  input: EmployeeProfileInput,
): Promise<EmployeeProfileActionResult> {
  try {
    const name = input.name.trim();
    if (!name) return { success: false, error: "Full name is required." };
    if (name.length > 100) return { success: false, error: "Full name must be 100 characters or fewer." };

    const phone = optionalText(input.phone, "Contact number", 40);
    const email = optionalText(input.email, "Email address", 254);
    const gender = optionalText(input.gender, "Gender", 40);
    const bloodGroup = optionalText(input.blood_group, "Blood group", 10);
    const emergencyContact = optionalText(input.emergency_contact, "Emergency contact", 40);
    const photoUrl = input.photo_url?.trim() || null;
    if (photoUrl) {
      let parsedPhotoUrl: URL;
      try {
        parsedPhotoUrl = new URL(photoUrl);
      } catch {
        return { success: false, error: "The profile photo URL is invalid. Please upload the image again." };
      }
      if (parsedPhotoUrl.protocol !== "https:" || photoUrl.length > 2048) {
        return { success: false, error: "The profile photo URL must use HTTPS and be 2,048 characters or fewer." };
      }
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: "Sign in before updating your profile." };
    }

    const { error: updateError } = await supabase.rpc("update_my_employee_profile", {
      p_name: name,
      p_phone: phone,
      p_email: email,
      p_gender: gender,
      p_blood_group: bloodGroup,
      p_emergency_contact: emergencyContact,
      p_photo_url: photoUrl,
    });
    if (updateError) {
      if (isMissingSelfProfileMigration(updateError.message)) {
        return {
          success: false,
          error: "Self-service profile editing is not enabled yet. Run supabase-self-profile-migration.sql in the Supabase SQL Editor.",
        };
      }
      return { success: false, error: updateError.message };
    }

    const { data: row, error: readError } = await supabase
      .from("profiles")
      .select("id,name,role,phone,email,gender,blood_group,emergency_contact,manager_name,photo_url")
      .eq("id", user.id)
      .single();
    if (readError) return { success: false, error: readError.message };

    revalidatePath("/dashboard/settings");
    revalidatePath("/dashboard/[section]", "page");
    revalidatePath("/dashboard/attendance");
    revalidatePath("/dashboard");

    const text = (value: unknown): string | null =>
      typeof value === "string" && value.trim() && value.trim() !== "-" ? value.trim() : null;
    return {
      success: true,
      profile: {
        id: String(row.id),
        name: String(row.name ?? "").trim(),
        role: row.role === "admin" || row.role === "manager" ? row.role : "employee",
        phone: text(row.phone),
        email: text(row.email),
        gender: text(row.gender),
        blood_group: text(row.blood_group),
        emergency_contact: text(row.emergency_contact),
        manager_name: text(row.manager_name),
        photo_url: text(row.photo_url),
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to update your profile.",
    };
  }
}
