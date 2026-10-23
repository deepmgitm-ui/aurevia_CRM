"use server";

import { revalidatePath } from "next/cache";

import { getViewer } from "./leads";
import { clinicDate } from "@/lib/attendance";
import { createClient } from "@/lib/supabase/server";

function currentMonthStart(): string {
  return `${clinicDate().slice(0, 7)}-01`;
}

export async function getStarOfMonthProfileId(): Promise<string | null> {
  const viewer = await getViewer();
  if (!viewer.success || !viewer.data || viewer.data.role === "employee") return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crm_star_of_month")
    .select("profile_id")
    .eq("month_start", currentMonthStart())
    .maybeSingle();
  if (error) {
    console.error("[agents] Could not read the monthly star:", error.message);
    return null;
  }
  return data?.profile_id ?? null;
}

export async function setStarOfMonthProfileId(profileId: string | null): Promise<{ success: boolean; error?: string }> {
  const viewer = await getViewer();
  if (!viewer.success || viewer.data?.role !== "admin") {
    return { success: false, error: "Only an admin can change the Star of the Month." };
  }

  const normalizedId = profileId?.trim() || null;
  if (normalizedId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizedId)) {
    return { success: false, error: "Choose a valid team member." };
  }

  const supabase = await createClient();
  if (normalizedId) {
    const { data: employee, error: employeeError } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", normalizedId)
      .eq("role", "employee")
      .maybeSingle();
    if (employeeError || !employee) return { success: false, error: "Choose an active employee from the team." };
  }

  const { error } = await supabase.from("crm_star_of_month").upsert(
    { month_start: currentMonthStart(), profile_id: normalizedId, updated_at: new Date().toISOString() },
    { onConflict: "month_start" },
  );
  if (error) return { success: false, error: "The Star of the Month could not be saved." };

  revalidatePath("/dashboard/agents");
  revalidatePath("/dashboard");
  return { success: true };
}
