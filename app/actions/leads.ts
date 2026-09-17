"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export type LeadStatus = string;

export type LeadTemperature = string;

export interface Lead {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  gender: string;
  city: string;
  disease: string;
  insurance_status: string;
  remarks: string;
  lead_date: string;
  follow_up_date: string;
  source: string;
  status: LeadStatus;
  temperature: LeadTemperature;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadActivity {
  id: string;
  lead_id: string;
  user_id: string;
  action_type: string;
  description: string | null;
  created_at: string;
}

export interface CreateLeadInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  gender?: string | null;
  city?: string | null;
  disease?: string | null;
  insurance_status?: string | null;
  remarks?: string | null;
  source?: string;
  lead_date?: string | null;
  temperature?: string | null;
  status?: string | null;
  follow_up_date?: string | null;
}

export interface BulkLeadInput {
  name: string;
  phone: string;
  email: string;
  gender: string;
  city: string;
  disease: string;
  insurance_status: string;
  remarks: string;
  lead_date: string;
  follow_up_date: string;
  source: string;
  status: string;
  temperature: string;
  assigned_to: string;
}

export interface Employee {
  id: string;
  name: string;
  role: "admin" | "manager" | "employee";
}

export interface UpdateLeadStatusInput {
  id: string;
  status: string;
  temperature: LeadTemperature;
}

export interface AddLeadActivityInput {
  lead_id: string;
  action_type: string;
  description?: string | null;
}

export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function dashIfEmpty(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "-";
}

function sanitizePhone(value: unknown): string {
  const digits = dashIfEmpty(value).replace(/\D/g, "");
  if (!digits) return "-";
  if (digits.length === 10) return digits;
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

function todayDate(): string {
  return new Date().toLocaleDateString("en-GB");
}

function parseLeadDate(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    return date.toLocaleDateString("en-GB");
  }

  if (typeof value !== "string" || !value.trim()) return todayDate();
  const text = value.trim();
  const dayFirst = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (dayFirst) {
    const [, day, month, yearValue] = dayFirst;
    const year = yearValue.length === 2 ? `20${yearValue}` : yearValue;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    if (!Number.isNaN(date.getTime())) return date.toLocaleDateString("en-GB");
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? todayDate() : date.toLocaleDateString("en-GB");
}

export async function getLeads(): Promise<ActionResult<Lead[]>> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      console.log("Profile Name:", null);
      console.log("Fetched Leads:", 0);
      return { success: true, data: [] };
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("name, role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      console.log("Profile Name:", null);
      console.log("Fetched Leads:", 0);
      return { success: true, data: [] };
    }

    console.log("Profile Name:", profile.name);

    if (profile.role === "employee" && !profile.name?.trim()) {
      console.log("Fetched Leads:", 0);
      return { success: true, data: [] };
    }

    const leadsQuery =
      profile.role === "employee"
        ? supabase
            .from("leads")
            .select("*")
            .ilike("assigned_to", profile.name)
            .order("created_at", { ascending: false })
        : supabase
            .from("leads")
            .select("*")
            .order("created_at", { ascending: false });

    const { data, error } = await leadsQuery;

    if (error) {
      return { success: false, error: error.message };
    }

    console.log("Fetched Leads:", data?.length ?? 0);
    return { success: true, data: (data ?? []) as Lead[] };
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error, "Unable to fetch leads."),
    };
  }
}

export async function getLeadActivities(
  leadId: string,
): Promise<ActionResult<LeadActivity[]>> {
  if (!leadId) {
    return { success: false, error: "Lead ID is required." };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("lead_activities")
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: (data ?? []) as LeadActivity[] };
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error, "Unable to fetch lead activities."),
    };
  }
}

export async function getEmployees(): Promise<ActionResult<Employee[]>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("id, name, role")
      .order("name", { ascending: true });

    if (error) return { success: false, error: error.message };
    return { success: true, data: (data ?? []) as Employee[] };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Unable to fetch employees.") };
  }
}

export async function createLead(
  input: CreateLeadInput,
): Promise<ActionResult<Lead>> {
  if (!input.name.trim()) {
    return { success: false, error: "Lead name is required." };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: profile } = user
      ? await supabase.from("profiles").select("name").eq("id", user.id).single()
      : { data: null };
    const { data, error } = await supabase
      .from("leads")
      .insert({
        name: input.name.trim(),
        phone: sanitizePhone(input.phone),
        email: dashIfEmpty(input.email),
        gender: dashIfEmpty(input.gender),
        city: dashIfEmpty(input.city),
        disease: dashIfEmpty(input.disease),
        insurance_status: dashIfEmpty(input.insurance_status),
        remarks: dashIfEmpty(input.remarks),
        lead_date: dashIfEmpty(input.lead_date) === "-" ? todayDate() : dashIfEmpty(input.lead_date),
        follow_up_date: dashIfEmpty(input.follow_up_date),
        source: "Manual",
        assigned_to: dashIfEmpty(profile?.name),
        temperature: dashIfEmpty(input.temperature),
        status: dashIfEmpty(input.status),
      })
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath("/dashboard");
    return { success: true, data: data as Lead };
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error, "Unable to create lead."),
    };
  }
}

export async function bulkInsertLeads(
  leads: unknown[],
  fileName: string,
): Promise<ActionResult<Lead[]>> {
  if (leads.length === 0) {
    return { success: false, error: "No leads were provided." };
  }

  const batchSource = fileName.trim() || "Excel/CSV";
  const supabase = await createClient();
  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("name");

  if (profilesError) {
    return { success: false, error: profilesError.message };
  }

  const validProfiles = (profiles ?? [])
    .filter((profile) => profile.name?.trim())
    .map((profile) => ({
      name: profile.name.trim(),
      normalizedName: profile.name.trim().toLowerCase(),
    }));
  const validProfileNames = new Map(
    validProfiles.map((profile) => [profile.normalizedName, profile.name]),
  );

  const records: BulkLeadInput[] = [];
  for (const lead of leads) {
    if (!lead || typeof lead !== "object") {
      continue;
    }

    const candidate = lead as Record<string, unknown>;
    const getField = (...keys: string[]): unknown => {
      const normalizedKeys = keys.map((key) => key.trim().toLowerCase());
      const entry = Object.entries(candidate).find(([key]) =>
        normalizedKeys.includes(key.trim().toLowerCase()),
      );
      return entry?.[1];
    };

    const importedDate = getField(
      "Date",
      "date",
      "Lead Date",
      "lead_date",
      "Date of Lead",
      "date_of_lead",
    );
    const followUpDate = getField("Follow-up Date", "follow_up_date");
    const importedAssignee = dashIfEmpty(getField("Assigned To", "assigned_to"));
    const assignedProfileName = validProfileNames.get(importedAssignee.toLowerCase()) ?? "-";

    records.push({
      name: dashIfEmpty(getField("Full Name", "name")),
      phone: sanitizePhone(getField("Contact no", "phone")),
      email: dashIfEmpty(getField("Email", "email")),
      gender: dashIfEmpty(getField("Gender", "gender")),
      city: dashIfEmpty(getField("City", "city")),
      disease: dashIfEmpty(getField("Disease", "disease")),
      insurance_status: dashIfEmpty(getField("Insurance Status", "insurance_status")),
      remarks: dashIfEmpty(getField("Remark 1", "remarks")),
      lead_date: parseLeadDate(importedDate),
      follow_up_date: dashIfEmpty(followUpDate),
      source: batchSource,
      status: dashIfEmpty(getField("Lead Status", "status")),
      temperature: "Warm",
      assigned_to: assignedProfileName,
    });
  }

  if (records.length === 0) {
    return { success: false, error: "No valid leads were found in the import." };
  }

  try {
    const { data: insertedLeads, error } = await supabase
      .from("leads")
      .insert(records)
      .select();

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath("/dashboard");
    return { success: true, data: (insertedLeads ?? []) as Lead[] };
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error, "Unable to import leads."),
    };
  }
}

export async function updateLeadStatus(
  input: UpdateLeadStatusInput,
): Promise<ActionResult<Lead>> {
  if (!input.id) {
    return { success: false, error: "Lead ID is required." };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("leads")
      .update({
        status: input.status,
        temperature: input.temperature,
      })
      .eq("id", input.id)
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath("/dashboard");
    return { success: true, data: data as Lead };
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error, "Unable to update lead status."),
    };
  }
}

export async function updateLeadTemperature(
  leadId: string,
  temp: string,
): Promise<ActionResult<Lead>> {
  if (!leadId || !temp.trim()) {
    return { success: false, error: "Lead and temperature are required." };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("leads")
      .update({ temperature: temp.trim() })
      .eq("id", leadId)
      .select()
      .single();

    if (error) return { success: false, error: error.message };
    revalidatePath("/dashboard");
    return { success: true, data: data as Lead };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Unable to update temperature.") };
  }
}

export async function updateLeadFollowUpDate(
  leadId: string,
  followUpDate: string,
): Promise<ActionResult<Lead>> {
  if (!leadId) return { success: false, error: "Lead ID is required." };

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("leads")
      .update({ follow_up_date: followUpDate.trim() || "-" })
      .eq("id", leadId)
      .select()
      .single();

    if (error) return { success: false, error: error.message };
    revalidatePath("/dashboard");
    return { success: true, data: data as Lead };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Unable to update follow-up date.") };
  }
}

export async function bulkDeleteLeads(
  leadIds: string[],
): Promise<ActionResult<{ deleted: number }>> {
  if (leadIds.length === 0) return { success: false, error: "No leads selected." };

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "You must be signed in." };

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (profile?.role !== "admin") return { success: false, error: "Only admins can delete leads." };

    const { data, error } = await supabase
      .from("leads")
      .delete()
      .in("id", leadIds)
      .select("id");
    if (error) return { success: false, error: error.message };

    revalidatePath("/dashboard");
    return { success: true, data: { deleted: data?.length ?? 0 } };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Unable to delete leads.") };
  }
}

export async function randomAssignLeads(
  leadIds: string[],
): Promise<ActionResult<{ assigned: number }>> {
  if (leadIds.length === 0) return { success: false, error: "No leads selected." };

  try {
    const supabase = await createClient();
    const { data: profiles, error: employeeError } = await supabase
      .from("profiles")
      .select("name")
      .order("name", { ascending: true });
    if (employeeError) return { success: false, error: employeeError.message };

    const validUsers = (profiles ?? []).filter(
      (profile) =>
        profile.name &&
        profile.name !== "-" &&
        profile.name !== "Unassigned",
    );
    if (validUsers.length === 0) return { success: false, error: "No valid users are available for assignment." };

    for (let i = 0; i < leadIds.length; i++) {
      const employeeName = validUsers[i % validUsers.length].name;
      const { error } = await supabase
        .from("leads")
        .update({ assigned_to: employeeName })
        .eq("id", leadIds[i]);
      if (error) return { success: false, error: error.message };
    }

    revalidatePath("/dashboard");
    return { success: true, data: { assigned: leadIds.length } };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Unable to assign leads.") };
  }
}

export async function updateLeadAssignment(
  leadId: string,
  employeeName: string,
): Promise<ActionResult<Lead>> {
  if (!leadId || !employeeName.trim()) {
    return { success: false, error: "Lead and employee are required." };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("leads")
      .update({ assigned_to: employeeName })
      .eq("id", leadId)
      .select()
      .single();

    if (error) return { success: false, error: error.message };
    revalidatePath("/dashboard");
    return { success: true, data: data as Lead };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Unable to update lead assignment.") };
  }
}

export async function addLeadActivity(
  input: AddLeadActivityInput,
): Promise<ActionResult<LeadActivity>> {
  if (!input.lead_id || !input.action_type.trim()) {
    return { success: false, error: "Lead and activity type are required." };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return { success: false, error: "You must be signed in to add activity." };
    }

    const { data, error } = await supabase
      .from("lead_activities")
      .insert({
        lead_id: input.lead_id,
        user_id: user.id,
        action_type: input.action_type.trim(),
        description: input.description?.trim() || null,
      })
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    if (input.action_type.trim().toLowerCase() === "note") {
      const { data: currentLead, error: currentLeadError } = await supabase
        .from("leads")
        .select("remarks")
        .eq("id", input.lead_id)
        .single();

      if (currentLeadError) return { success: false, error: currentLeadError.message };
      const currentRemarks = currentLead?.remarks && currentLead.remarks !== "-"
        ? currentLead.remarks
        : "";
      const nextRemarks = [currentRemarks, input.description?.trim() || "-"]
        .filter(Boolean)
        .join("\n");
      const { error: remarkError } = await supabase
        .from("leads")
        .update({ remarks: nextRemarks })
        .eq("id", input.lead_id);

      if (remarkError) return { success: false, error: remarkError.message };
    }

    revalidatePath("/dashboard");
    return { success: true, data: data as LeadActivity };
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error, "Unable to add lead activity."),
    };
  }
}
