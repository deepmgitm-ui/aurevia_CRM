"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { assignLeadsToEmployees, getViewer } from "./leads";

export interface LeadDeletionReviewView {
  id: string;
  leadId: string;
  leadName: string;
  phone: string;
  status: string;
  assignedTo: string;
  hadPreviousAssignment: boolean;
  closedSince: string;
  deleteAfter: string;
  snoozedUntil: string | null;
  agentNote: string | null;
}

export async function getDeletionReviews(): Promise<{
  role: string;
  reviews: LeadDeletionReviewView[];
  error: string | null;
}> {
  const supabase = await createClient();
  const viewer = await getViewer();
  const role = viewer.success ? viewer.data?.role ?? "" : "";
  if (role !== "admin") return { role, reviews: [], error: null };

  const { data, error } = await supabase
    .from("crm_lead_deletion_reviews")
    .select("id, lead_id, assigned_to, closed_status, closed_since, delete_after, snoozed_until, agent_note, lead:leads(name, phone, status, assigned_to, had_previous_assignment)")
    .eq("decision", "pending")
    .order("created_at", { ascending: true });
  if (error) return { role, reviews: [], error: "Deletion reviews could not be loaded. Please refresh." };

  return {
    role,
    error: null,
    reviews: (data ?? []).flatMap((row) => {
      const lead = Array.isArray(row.lead) ? row.lead[0] : row.lead;
      if (!lead) return [];
      return [{
        id: row.id,
        leadId: row.lead_id,
        leadName: lead.name ?? "Unnamed lead",
        phone: lead.phone ?? "",
        status: lead.status ?? row.closed_status ?? "Closed",
        assignedTo: lead.assigned_to && lead.assigned_to !== "-" ? lead.assigned_to : "Unassigned",
        hadPreviousAssignment: lead.had_previous_assignment ?? false,
        closedSince: row.closed_since,
        deleteAfter: row.delete_after,
        snoozedUntil: row.snoozed_until,
        agentNote: row.agent_note,
      }];
    }),
  };
}

export async function getDeletionReviewAssignees(): Promise<{ names: string[]; error: string | null }> {
  const viewer = await getViewer();
  if (!viewer.success || viewer.data?.role !== "admin") return { names: [], error: "Only admins can assign reviewed leads." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("name")
    .eq("role", "employee")
    .not("name", "is", null)
    .order("name", { ascending: true });
  if (error) return { names: [], error: "Team members could not be loaded for assignment." };
  return { names: (data ?? []).map((profile) => profile.name).filter((name): name is string => typeof name === "string" && Boolean(name.trim())) , error: null };
}

export async function assignDeletionReviewLeads(input: {
  reviewIds: string[];
  employeeNames: string[];
  asFresh: boolean;
}): Promise<{ success: boolean; error?: string; assigned?: number }> {
  const viewer = await getViewer();
  if (!viewer.success || viewer.data?.role !== "admin") return { success: false, error: "Only admins can reassign closed leads." };
  if (!input || !Array.isArray(input.reviewIds) || !Array.isArray(input.employeeNames) || typeof input.asFresh !== "boolean") {
    return { success: false, error: "Choose the leads, team members, and transfer status." };
  }
  const reviewIds = [...new Set(input.reviewIds.filter((id) => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))];
  const employeeNames = [...new Set(input.employeeNames.filter((name) => typeof name === "string").map((name) => name.trim()).filter(Boolean))];
  if (!reviewIds.length || reviewIds.length > 10000) return { success: false, error: "Select between 1 and 10,000 closed leads." };
  if (!employeeNames.length) return { success: false, error: "Select at least one employee." };
  if (reviewIds.length !== input.reviewIds.length) return { success: false, error: "One or more selected reviews are invalid. Refresh and try again." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crm_lead_deletion_reviews")
    .select("lead_id")
    .in("id", reviewIds)
    .eq("decision", "pending");
  if (error) return { success: false, error: "Selected closed leads could not be verified. Refresh and try again." };
  const leadIds = (data ?? []).map((row) => row.lead_id);
  if (leadIds.length !== reviewIds.length) return { success: false, error: "Some selected reviews are no longer pending. Refresh and try again." };

  const result = await assignLeadsToEmployees({ leadIds, employeeNames, asFresh: input.asFresh, batchLabel: "Closed lead review transfer" });
  if (!result.success) return { success: false, error: result.error };
  revalidatePath("/dashboard", "layout");
  revalidatePath("/dashboard/closed-lead-reviews");
  revalidatePath("/dashboard/leads");
  return { success: true, assigned: result.data.assigned };
}

export async function getPendingDeletionReviewCount(): Promise<number> {
  const viewer = await getViewer();
  if (!viewer.success || viewer.data?.role !== "admin") return 0;
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("crm_lead_deletion_reviews")
    .select("id", { count: "exact", head: true })
    .eq("decision", "pending");
  return error ? 0 : count ?? 0;
}

/** Fetch the full authorized lead row before an admin deletes it from review. */
export async function getDeletionReviewLeadForExport(reviewId: string): Promise<{
  success: boolean;
  lead?: Record<string, unknown>;
  error?: string;
}> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reviewId ?? "")) {
    return { success: false, error: "Select a valid deletion review." };
  }
  const viewer = await getViewer();
  if (!viewer.success || viewer.data?.role !== "admin") {
    return { success: false, error: "Only admins can export a lead for deletion." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crm_lead_deletion_reviews")
    .select("lead:leads(*)")
    .eq("id", reviewId)
    .maybeSingle();
  if (error) return { success: false, error: "The lead backup could not be prepared. Nothing was deleted." };
  const lead = Array.isArray(data?.lead) ? data.lead[0] : data?.lead;
  if (!lead) return { success: false, error: "This lead is no longer available. Nothing was deleted." };
  return { success: true, lead: lead as Record<string, unknown> };
}

function formText(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function submitDeletionReviewNote(formData: FormData): Promise<void> {
  const reviewId = formText(formData, "reviewId");
  const note = formText(formData, "note");
  if (!reviewId || note.length < 2 || note.length > 1200) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_submit_deletion_review_note", {
    p_review_id: reviewId,
    p_note: note,
  });
  if (error) throw new Error("Your note could not be sent. Refresh and try again.");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/closed-lead-reviews");
}

export async function resolveDeletionReview(formData: FormData): Promise<void> {
  const reviewId = formText(formData, "reviewId");
  const action = formText(formData, "action");
  if (!reviewId || !["delete", "keep", "snooze"].includes(action)) return;
  const snoozeDays = Number(formText(formData, "snoozeDays"));
  if (action === "snooze" && ![1, 2].includes(snoozeDays)) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_admin_resolve_deletion_review", {
    p_review_id: reviewId,
    p_action: action,
    p_snooze_days: action === "snooze" ? snoozeDays : null,
  });
  if (error) throw new Error("The deletion review could not be updated. Refresh and try again.");
  revalidatePath("/dashboard", "layout");
  revalidatePath("/dashboard/closed-lead-reviews");
  revalidatePath("/dashboard/leads");
}
