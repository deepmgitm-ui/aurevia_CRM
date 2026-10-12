"use server";

import { createClient } from "@/lib/supabase/server";
import { isWorkDate } from "@/lib/daily-work";
import { clinicDate } from "@/lib/attendance";
import type { StaffActivity } from "@/lib/team-activity";

export async function recordMyActivity(active: boolean) {
  if (typeof active !== "boolean") return false;
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_activity_heartbeat", {
    p_active: active,
  });
  return !error;
}

export async function getStaffActivity(day = clinicDate()) {
  if (!isWorkDate(day))
    return { success: false as const, error: "Choose a valid date." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crm_activity_roster", {
    p_day: day,
  });
  return error
    ? {
        success: false as const,
        error: "Team activity could not be loaded. Please retry.",
      }
    : { success: true as const, data: data as StaffActivity[] };
}
