"use server";

import { createClient } from "@/lib/supabase/server";
import { getViewer } from "./leads";

export type LeadRetentionReminder = {
  lead_id: string;
  lead_name: string;
  lead_phone: string;
  lead_status: string;
  assigned_to: string;
  created_at: string;
  expires_at: string;
};

export type LeadRetentionArchivePreview = {
  id: string;
  deleted_at: string;
  deleted_by_name: string;
  lead_count: number;
  activity_count: number;
  lead_rows: Array<{ name?: string | null }>;
};

export async function getLeadRetentionDashboardData(): Promise<{
  reminders: LeadRetentionReminder[];
  archives: LeadRetentionArchivePreview[];
  error: string | null;
}> {
  const viewer = await getViewer();
  if (!viewer.success || viewer.data?.role !== "admin") {
    return { reminders: [], archives: [], error: null };
  }

  const supabase = await createClient();
  const [reminderResult, archiveResult] = await Promise.all([
    supabase.rpc("crm_admin_lead_retention_reminders", { p_limit: 8 }),
    supabase
      .from("crm_lead_retention_archives")
      .select("id, deleted_at, deleted_by_name, lead_count, activity_count, lead_rows")
      .order("deleted_at", { ascending: false })
      .limit(5),
  ]);

  if (reminderResult.error || archiveResult.error) {
    return { reminders: [], archives: [], error: "Lead retention details could not be loaded. Refresh to try again." };
  }

  return {
    reminders: (reminderResult.data ?? []) as LeadRetentionReminder[],
    archives: (archiveResult.data ?? []) as LeadRetentionArchivePreview[],
    error: null,
  };
}
