"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "./leads";
import type { TaskLead } from "@/app/dashboard/tasks/task-center";

export interface TaskPageData {
  leads: TaskLead[];
  total: number;
  stats: { total: number; overdue: number; today: number; upcoming: number; stale: number };
}
export async function getTaskPage(bucket = "all", search = "", page = 1) {
  const supabase = await createClient();
  const viewer = await getViewer();
  if (!viewer.success || !viewer.data)
    return { success: false as const, error: "Sign in to view follow-ups." };
  const { data, error } = await supabase.rpc("crm_task_page", {
    p_bucket: ["all", "overdue", "today", "upcoming", "stale"].includes(bucket)
      ? bucket
      : "all",
    p_search: search.trim().slice(0, 120),
    p_page: Math.max(1, Math.floor(page)),
  });
  return error
    ? {
        success: false as const,
        error: "Follow-ups could not be loaded. Please retry.",
      }
    : { success: true as const, data: data as TaskPageData };
}
export async function getAgentDailyReport(day: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crm_agent_daily_report", {
    p_day: day,
  });
  return error
    ? { success: false as const, error: "Daily report could not be loaded." }
    : { success: true as const, data: data as AgentDailyRow[] };
}
export interface AgentDailyRow {
  id: string;
  name: string;
  role: string;
  assigned: number;
  calls: number;
  patients_called: number;
  connected: number;
  pending: number;
  opd_done: number;
  ipd_done: number;
}
export async function getCapacity() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crm_capacity");
  return error
    ? null
    : (data as {
        databaseBytes: number;
        leads: number;
        staff: number;
        leadBytes: number;
        activityBytes: number;
        appointments: number;
      });
}
export interface DuplicateLead {
  id: string;
  name: string;
  status: string;
  assignedTo: string;
  updatedAt: string;
}
export interface DuplicateGroup {
  phone: string;
  count: number;
  leads: DuplicateLead[];
}
export async function getDuplicates(page = 1) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crm_duplicate_groups", {
    p_page: page,
  });
  return error
    ? {
        success: false as const,
        error: "Duplicate review could not be loaded.",
      }
    : {
        success: true as const,
        data: data as { total: number; groups: DuplicateGroup[] },
      };
}
export async function mergeDuplicate(
  target: DuplicateLead,
  source: DuplicateLead,
  phone: string,
) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crm_merge_leads", {
    p_target: target.id,
    p_source: source.id,
    p_target_version: target.updatedAt,
    p_source_version: source.updatedAt,
    p_phone: phone,
  });
  if (error) return { success: false as const, error: error.message };
  revalidatePath("/dashboard", "layout");
  return {
    success: true as const,
    data: data as { id: string; backupId: string },
  };
}
export async function getMergeBackup(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crm_merge_history")
    .select("id,target_id,source_snapshot,target_snapshot,created_at")
    .eq("id", id)
    .single();
  return error ? null : data;
}
export async function getScheduler() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crm_runtime_settings")
    .select("automatic_enabled")
    .eq("id", true)
    .single();
  return error ? null : (data?.automatic_enabled as boolean);
}
export async function setScheduler(enabled: boolean) {
  const supabase = await createClient();
  const viewer = await getViewer();
  if (!viewer.success || viewer.data?.role !== "admin") return false;
  const { error } = await supabase
    .from("crm_runtime_settings")
    .update({ automatic_enabled: enabled })
    .eq("id", true)
    .select("id")
    .single();
  revalidatePath("/dashboard/settings");
  return !error;
}

export async function getSchedulerStatus() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crm_scheduler_status");
  return error
    ? null
    : (data as {
        startedAt: string | null;
        status: string | null;
        message: string | null;
      });
}
