"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export type ProfileActionResult =
  | { success: true; name: string }
  | { success: false; error: string };

export async function updateProfileName(
  newName: string,
): Promise<ProfileActionResult> {
  const name = newName.trim();
  if (!name) {
    return { success: false, error: "Name is required." };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return { success: false, error: "You must be signed in to update your profile." };
    }

    const { error } = await supabase
      .from("profiles")
      .update({ name })
      .eq("id", user.id);

    if (error) {
      return { success: false, error: error.message };
    }

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
