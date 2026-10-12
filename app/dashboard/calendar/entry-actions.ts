"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getLeadsPage, getViewer } from "@/app/actions/leads";
import { createClient } from "@/lib/supabase/server";
import { CALENDAR_ENTRY_TYPES, calendarPhone, validateCalendarEntry, type CalendarEntryInput } from "@/lib/calendar-entry";
import type { CalendarResult } from "./actions";

export interface CalendarEditorLead {
  id: string; name: string; phone: string | null; city: string; remarks: string;
  status: string; assigned_to: string | null; updated_at: string;
  opd_booked_date?: string | null; opd_done_date?: string | null; ipd_done_date?: string | null;
}

async function calendarAdmin() {
  const result = await getViewer();
  return result.success && result.data?.role === "admin" ? result.data : null;
}

export async function getCalendarEditorSetup(): Promise<{ canEdit: boolean; agents: string[] }> {
  if (!await calendarAdmin()) return { canEdit: false, agents: [] };
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("name").order("name");
  return { canEdit: true, agents: (data ?? []).map((row) => row.name?.trim()).filter((name): name is string => Boolean(name)) };
}

export async function searchCalendarLeads(search: string): Promise<CalendarResult<CalendarEditorLead[]>> {
  if (!await calendarAdmin()) return { success: false, error: "Only admins can edit calendar appointments." };
  if (typeof search !== "string" || search.trim().length < 2) return { success: false, error: "Enter at least two characters to search." };
  const result = await getLeadsPage(1, 20, search.trim().slice(0, 120));
  if (!result.success) return { success: false, error: result.error };
  return { success: true, data: result.data.leads.map(({ id, name, phone, city, remarks, status, assigned_to, updated_at, opd_booked_date, opd_done_date, ipd_done_date }) => ({ id, name, phone, city, remarks, status, assigned_to, updated_at, opd_booked_date, opd_done_date, ipd_done_date })) };
}

export async function getCalendarEditorLead(id: string): Promise<CalendarResult<CalendarEditorLead>> {
  if (!await calendarAdmin()) return { success: false, error: "Only admins can edit calendar appointments." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("leads")
    .select("id,name,phone,city,remarks,status,assigned_to,updated_at,opd_booked_date,opd_done_date,ipd_done_date").eq("id", id).single();
  return error || !data ? { success: false, error: "Patient could not be loaded. Please search again." } : { success: true, data: data as CalendarEditorLead };
}

export async function saveCalendarEntry(input: CalendarEntryInput): Promise<CalendarResult<{ id: string; warning?: string }>> {
  try {
    const admin = await calendarAdmin();
    if (!admin) return { success: false, error: "Only admins can edit calendar appointments." };
    const validation = validateCalendarEntry(input);
    if (validation) return { success: false, error: validation };
    const supabase = await createClient();
    const field = CALENDAR_ENTRY_TYPES[input.kind];
    const phone = calendarPhone(input.phone);
    let phoneChanged = true;
    if (input.mode === "existing") {
      const before = await supabase.from("leads").select("phone").eq("id", input.leadId!).single();
      if (before.error || !before.data) return { success: false, error: "Patient could not be loaded. Please select it again." };
      phoneChanged = calendarPhone(before.data.phone ?? "") !== phone;
    }
    if (phone !== "-" && phoneChanged) {
      let duplicateQuery = supabase.from("leads").select("id").eq("phone", phone).limit(1);
      if (input.mode === "existing") duplicateQuery = duplicateQuery.neq("id", input.leadId!);
      const duplicate = await duplicateQuery;
      if (duplicate.error) return { success: false, error: "Unable to check existing patients. Please retry." };
      if (duplicate.data?.length) return { success: false, error: "This phone already belongs to another lead. Search and select that patient instead." };
    }
    const details = {
      name: input.name.trim(), phone, city: input.city.trim() || "-", remarks: input.remarks.trim() || "-",
      [field.column]: input.date,
      ...(input.mode === "new" || input.updateStatus ? { status: field.status } : {}),
    };
    let saved;
    if (input.mode === "new") {
      if (input.assignedTo) {
        const agent = await supabase.from("profiles").select("id").eq("name", input.assignedTo).maybeSingle();
        if (agent.error || !agent.data) return { success: false, error: "Choose a valid agent or leave the patient unassigned." };
      }
      saved = await supabase.from("leads").insert({
        ...details, assigned_to: input.assignedTo || "-", email: "-", gender: "-", disease: "-",
        insurance_status: "-", follow_up_date: "-", temperature: "Warm", source: "Manual",
        lead_date: new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata" }).format(new Date()),
        source_batch_id: randomUUID(), source_batch_label: `Calendar entry — ${input.name.trim()}`.slice(0, 240),
        source_batch_created_at: new Date().toISOString(),
      }).select("id").single();
    } else {
      // Optimistic locking prevents an older form overwriting another user's changes.
      saved = await supabase.from("leads").update(details).eq("id", input.leadId!)
        .eq("updated_at", input.expectedUpdatedAt!).select("id").maybeSingle();
    }
    if (saved.error) return { success: false, error: "Appointment could not be saved. Please retry or contact support." };
    if (!saved.data) return { success: false, error: "This patient was changed elsewhere. Select the patient again to load the latest details." };
    const audit = await supabase.from("lead_activities").insert({ lead_id: saved.data.id, user_id: admin.id, action_type: "note", description: `Calendar ${input.mode === "new" ? "patient added" : "patient updated"} — ${field.label}: ${input.date}${input.updateStatus || input.mode === "new" ? `; status: ${field.status}` : "; lead status preserved"}` });
    revalidatePath("/dashboard", "layout");
    return { success: true, data: { id: saved.data.id, ...(audit.error ? { warning: "Appointment saved, but its activity note could not be recorded." } : {}) } };
  } catch {
    return { success: false, error: "Unable to reach the server. Please try again." };
  }
}
