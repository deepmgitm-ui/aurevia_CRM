"use server";

import { revalidatePath } from "next/cache";
import { getLeadsPage, getViewer } from "@/app/actions/leads";
import { createClient } from "@/lib/supabase/server";
import { shouldSyncLeadStatus, validateCalendarEntry, type CalendarEntryInput } from "@/lib/calendar-entry";
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

export async function saveCalendarEntry(input: CalendarEntryInput): Promise<CalendarResult<{id:string;appointmentId:string;warning?:string}>> {
 try {
  if(!await calendarAdmin()) return {success:false,error:"Only admins can edit calendar appointments."};
  const validation=validateCalendarEntry(input);if(validation)return {success:false,error:validation};
  const supabase=await createClient();const normalizedInput={...input,updateStatus:input.mode==="existing"?shouldSyncLeadStatus(input.appointmentStatus):input.updateStatus};const {data,error}=await supabase.rpc("crm_save_calendar_entry",{p:normalizedInput});
  if(error)return {success:false,error:error.message};
  revalidatePath("/dashboard","layout");return {success:true,data};
 }catch{return {success:false,error:"Appointment could not be saved. Please retry."};}
}
