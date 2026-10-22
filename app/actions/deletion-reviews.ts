"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export interface LeadDeletionReviewView {
  id: string;
  leadName: string;
  phone: string;
  status: string;
  assignedTo: string;
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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { role: "", reviews: [], error: null };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const role = profile?.role ?? "";
  if (role !== "admin" && role !== "employee") return { role, reviews: [], error: null };

  const { data, error } = await supabase
    .from("crm_lead_deletion_reviews")
    .select("id, assigned_to, closed_status, closed_since, delete_after, snoozed_until, agent_note, lead:leads(name, phone, status)")
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
        leadName: lead.name ?? "Unnamed lead",
        phone: lead.phone ?? "",
        status: lead.status ?? row.closed_status ?? "Closed",
        assignedTo: row.assigned_to ?? "Unassigned",
        closedSince: row.closed_since,
        deleteAfter: row.delete_after,
        snoozedUntil: row.snoozed_until,
        agentNote: row.agent_note,
      }];
    }),
  };
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
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/leads");
}
