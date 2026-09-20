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

// Normalizes any phone string to bare digits (last 10 when longer) so stored
// values and uploaded values can be compared for duplicate detection.
function normalizePhoneDigits(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function todayDate(): string {
  return new Date().toLocaleDateString("en-GB");
}

// Converts any cell value (string, number, boolean, Date, nested junk) into safe
// trimmed text. Unknown shapes become "" instead of throwing.
function toTextField(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return String(value);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toLocaleDateString("en-GB");
  }
  return "";
}

// The exact column list of the public.leads table. The bulk-insert payload is
// filtered down to these keys so a stray field from a spreadsheet can never
// reach Supabase and trigger a "schema cache" (PGRST204) error.
const LEADS_INSERT_COLUMNS = [
  "name",
  "phone",
  "email",
  "gender",
  "city",
  "disease",
  "insurance_status",
  "remarks",
  "lead_date",
  "follow_up_date",
  "source",
  "status",
  "temperature",
  "assigned_to",
] as const;

function pickLeadColumns(record: Record<string, unknown>): Record<string, string> {
  const payload: Record<string, string> = {};
  for (const column of LEADS_INSERT_COLUMNS) {
    const value = record[column];
    if (typeof value === "string" && value.length > 0) {
      payload[column] = value;
    }
  }
  return payload;
}

function parseLeadDate(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    return date.toLocaleDateString("en-GB");
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toLocaleDateString("en-GB");
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
// Page size for server-side pagination. The table fetches 50 leads per page so
// the dashboard stays fast with 1k+ leads instead of loading the entire table.
const LEADS_PAGE_SIZE = 50;

export interface LeadCounts {
  total: number;
  new: number;
  hot: number;
  won: number;
  lost: number;
}

export interface LeadsPageData {
  leads: Lead[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// Builds the role-scoped base query (employees only see leads assigned to them).
// The query is a builder, so callers can chain .range()/.eq() on top of it.
function buildScopedLeadsQuery(
  supabase: Awaited<ReturnType<typeof createClient>>,
  role: string,
  employeeName: string | null,
  withCount = false,
  assignedTo = "",
) {
  const base = supabase.from("leads").select("id", withCount ? { count: "exact", head: true } : undefined);
  if (role === "employee") return base.ilike("assigned_to", employeeName ?? "");
  // Admins/managers can drill down into one specific employee's leads.
  return assignedTo.trim() ? base.eq("assigned_to", assignedTo.trim()) : base;
}

// Returns the signed-in user's role (null when unauthenticated) for server-side
// RBAC checks. Employees are rejected from destructive and bulk operations —
// UI hiding alone is never treated as security.
async function getViewerRole(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  return profile?.role ?? null;
}

// Builds a PostgREST `.or()` expression for server-side search across the
// name/phone/disease columns. Wildcards (%, _) are backslash-escaped and
// double quotes are stripped so the term can never break the filter syntax;
// values are double-quoted so commas/parentheses inside the term stay literal.
// Returns null when the search term is empty (no filter to apply).
function buildLeadSearchFilter(search: string): string | null {
  const term = search.trim();
  if (!term) return null;
  const safe = term.replace(/"/g, "").replace(/[%_\\]/g, (ch) => `\\${ch}`);
  return [
    `name.ilike."%${safe}%"`,
    `phone.ilike."%${safe}%"`,
    `disease.ilike."%${safe}%"`,
  ].join(",");
}

// Status-filter values that actually live in the temperature column
// (Hot/Warm/Cold); every other filter value targets the status column.
const TEMPERATURE_FILTERS = new Set(["hot", "warm", "cold"]);

export async function getLeadsPage(
  page = 1,
  pageSize = LEADS_PAGE_SIZE,
  search = "",
  assignedTo = "",
  statusFilter = "",
): Promise<ActionResult<LeadsPageData>> {
  const safePageSize = Math.min(Math.max(pageSize, 1), 200);
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: true, data: { leads: [], total: 0, page: 1, pageSize: safePageSize, totalPages: 1 } };
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("name, role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return { success: true, data: { leads: [], total: 0, page: 1, pageSize: safePageSize, totalPages: 1 } };
    }

    if (profile.role === "employee" && !profile.name?.trim()) {
      return { success: true, data: { leads: [], total: 0, page: 1, pageSize: safePageSize, totalPages: 1 } };
    }

    const safePage = Math.max(page, 1);
    const from = (safePage - 1) * safePageSize;
    const to = from + safePageSize - 1;

    // count: "exact" returns the total row count alongside the current page,
    // and .range() fetches only this page's rows from Supabase.
    const searchFilter = buildLeadSearchFilter(search);
    let leadsQuery = supabase.from("leads").select("*", { count: "exact" });
    if (profile.role === "employee") {
      leadsQuery = leadsQuery.ilike("assigned_to", profile.name);
    } else if (assignedTo.trim()) {
      // Admin drill-down: show only the selected employee's leads.
      leadsQuery = leadsQuery.eq("assigned_to", assignedTo.trim());
    }
    if (searchFilter) {
      // Server-side search: a single .or() across name/phone/disease matches
      // ALL leads in the database, not just the 50 rows on the current page.
      leadsQuery = leadsQuery.or(searchFilter);
    }
    const statusFilterNormalized = statusFilter.trim().toLowerCase();
    if (statusFilterNormalized) {
      // Advanced status filter: Hot/Warm/Cold target the temperature column,
      // every other value (New, OPD Done, Won, Lost, ...) targets status.
      leadsQuery = TEMPERATURE_FILTERS.has(statusFilterNormalized)
        ? leadsQuery.eq("temperature", statusFilter.trim())
        : leadsQuery.eq("status", statusFilter.trim());
    }
    const { data, error, count } = await leadsQuery
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      return { success: false, error: error.message };
    }

    const total = count ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / safePageSize));

    return {
      success: true,
      data: {
        leads: (data ?? []) as Lead[],
        total,
        page: Math.min(safePage, totalPages),
        pageSize: safePageSize,
        totalPages,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error, "Unable to fetch leads."),
    };
  }
}

// Admin-only CSV export: bypasses pagination with a bounded, chunked fetch of
// ALL leads matching the current server-side filters (search + status +
// employee drill-down), capped at EXPORT_LIMIT rows for safety.
export async function getLeadsForExport(
  search = "",
  statusFilter = "",
  assignedTo = "",
): Promise<ActionResult<Lead[]>> {
  const EXPORT_LIMIT = 5000;
  const chunkSize = 1000;
  try {
    const supabase = await createClient();

    // RBAC: strictly Admins — employees and managers cannot export data.
    const viewerRole = await getViewerRole(supabase);
    if (viewerRole !== "admin") {
      return { success: false, error: "Only admins can export leads (403 Forbidden)." };
    }

    let exportQuery = supabase.from("leads").select("*");
    if (assignedTo.trim()) exportQuery = exportQuery.eq("assigned_to", assignedTo.trim());
    const searchFilter = buildLeadSearchFilter(search);
    if (searchFilter) exportQuery = exportQuery.or(searchFilter);
    const statusFilterNormalized = statusFilter.trim().toLowerCase();
    if (statusFilterNormalized) {
      exportQuery = TEMPERATURE_FILTERS.has(statusFilterNormalized)
        ? exportQuery.eq("temperature", statusFilter.trim())
        : exportQuery.eq("status", statusFilter.trim());
    }
    exportQuery = exportQuery.order("created_at", { ascending: false });

    const rows: Lead[] = [];
    for (let from = 0; from < EXPORT_LIMIT; from += chunkSize) {
      const { data, error } = await exportQuery.range(from, from + chunkSize - 1);
      if (error) return { success: false, error: error.message };
      const chunk = (data ?? []) as Lead[];
      rows.push(...chunk);
      if (chunk.length < chunkSize) break;
    }

    return { success: true, data: rows };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Unable to export leads.") };
  }
}

// Lightweight stat counters for the dashboard cards. Uses head-only exact
// counts instead of loading every lead row, so it stays fast at 1k+ leads.
export async function getLeadCounts(assignedTo = ""): Promise<ActionResult<LeadCounts>> {
  const emptyCounts: LeadCounts = { total: 0, new: 0, hot: 0, won: 0, lost: 0 };
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: true, data: emptyCounts };
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("name, role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return { success: true, data: emptyCounts };
    }

    if (profile.role === "employee" && !profile.name?.trim()) {
      return { success: true, data: emptyCounts };
    }

    const totalQuery = buildScopedLeadsQuery(supabase, profile.role, profile.name, true, assignedTo);
    const statusCountQuery = (status: string) =>
      buildScopedLeadsQuery(supabase, profile.role, profile.name, true, assignedTo).eq("status", status);
    const hotQuery = buildScopedLeadsQuery(supabase, profile.role, profile.name, true, assignedTo).eq("temperature", "Hot");

    const [totalRes, newRes, hotRes, wonRes, lostRes] = await Promise.all([
      totalQuery,
      statusCountQuery("New"),
      hotQuery,
      statusCountQuery("Won"),
      statusCountQuery("Lost"),
    ]);

    for (const result of [totalRes, newRes, hotRes, wonRes, lostRes]) {
      if (result.error) {
        return { success: false, error: result.error.message };
      }
    }

    return {
      success: true,
      data: {
        total: totalRes.count ?? 0,
        new: newRes.count ?? 0,
        hot: hotRes.count ?? 0,
        won: wonRes.count ?? 0,
        lost: lostRes.count ?? 0,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error, "Unable to fetch lead counts."),
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

export type ViewerRole = "admin" | "manager" | "employee";

export interface Viewer {
  id: string;
  name: string;
  role: ViewerRole;
}

// Returns the signed-in user's profile (or null when signed out) so the
// dashboard can decide between the Team Overview (admin/manager) and the
// employee's own leads table.
export async function getViewer(): Promise<ActionResult<Viewer | null>> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) return { success: true, data: null };

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, name, role")
      .eq("id", user.id)
      .single();
    if (profileError || !profile) return { success: true, data: null };

    return {
      success: true,
      data: { id: profile.id, name: profile.name ?? "", role: profile.role as ViewerRole },
    };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Unable to load your profile.") };
  }
}

export interface EmployeeLeadStats {
  id: string;
  name: string;
  total: number;
  hot: number;
  warm: number;
  cold: number;
  newLeads: number;
  won: number;
  lost: number;
  opdDone: number;
}

export interface TeamStats {
  employees: EmployeeLeadStats[];
  // Leads whose assigned_to doesn't match any profile (e.g. "-", removed users).
  unassigned: number;
  total: number;
}

// Team Overview data for the admin dashboard: total leads plus key
// temperature/status breakdowns for every employee. Aggregates by fetching
// only 3 small columns in bounded chunks, so it stays fast with 10k+ leads.
export async function getTeamStats(): Promise<ActionResult<TeamStats>> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return { success: true, data: { employees: [], unassigned: 0, total: 0 } };
    }

    const { data: viewerProfile, error: viewerProfileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (viewerProfileError || !viewerProfile || viewerProfile.role === "employee") {
      return { success: true, data: { employees: [], unassigned: 0, total: 0 } };
    }

    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, name")
      .order("name", { ascending: true });
    if (profilesError) return { success: false, error: profilesError.message };

    const statsByName = new Map<string, EmployeeLeadStats>();
    for (const row of profiles ?? []) {
      if (!row.name?.trim()) continue;
      statsByName.set(row.name.trim(), {
        id: row.id,
        name: row.name.trim(),
        total: 0,
        hot: 0,
        warm: 0,
        cold: 0,
        newLeads: 0,
        won: 0,
        lost: 0,
        opdDone: 0,
      });
    }

    let unassigned = 0;
    let total = 0;
    const chunkSize = 1000;
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from("leads")
        .select("assigned_to, status, temperature")
        .range(from, from + chunkSize - 1);
      if (error) return { success: false, error: error.message };

      const rows = data ?? [];
      for (const row of rows) {
        total += 1;
        const assignedName = typeof row.assigned_to === "string" ? row.assigned_to.trim() : "";
        const stats = assignedName ? statsByName.get(assignedName) : undefined;
        if (!stats) {
          unassigned += 1;
          continue;
        }
        stats.total += 1;
        const temperature = typeof row.temperature === "string" ? row.temperature.trim().toLowerCase() : "";
        if (temperature.startsWith("hot")) stats.hot += 1;
        else if (temperature.startsWith("warm")) stats.warm += 1;
        else if (temperature.startsWith("cold")) stats.cold += 1;
        const status = typeof row.status === "string" ? row.status.trim().toLowerCase() : "";
        if (status === "new") stats.newLeads += 1;
        else if (status === "won") stats.won += 1;
        else if (status === "lost") stats.lost += 1;
        else if (status === "opd done") stats.opdDone += 1;
      }
      if (rows.length < chunkSize) break;
      from += chunkSize;
    }

    return {
      success: true,
      data: { employees: [...statsByName.values()], unassigned, total },
    };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Unable to fetch team stats.") };
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

export interface ImportResult {
  leads: Lead[];
  // Rows skipped because their phone number already exists in the database.
  skippedDuplicates: number;
  // Rows skipped as malformed/blank during parsing.
  skippedRows: number;
}

export async function bulkInsertLeads(
  leads: unknown[],
  fileName: string,
): Promise<ActionResult<ImportResult>> {
  if (leads.length === 0) {
    return { success: false, error: "No leads were provided." };
  }

  const batchSource = fileName.trim() || "Excel/CSV";
  const supabase = await createClient();

  // RBAC: bulk import is an Admin/Manager capability. Employees add leads
  // one at a time via createLead.
  const viewerRole = await getViewerRole(supabase);
  if (!viewerRole || viewerRole === "employee") {
    return { success: false, error: "Only admins and managers can bulk-import leads (403 Forbidden)." };
  }

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
  let skippedRows = 0;
  for (const lead of leads) {
    try {
      if (!lead || typeof lead !== "object" || Array.isArray(lead)) {
        skippedRows += 1;
        continue;
      }

      const candidate = lead as Record<string, unknown>;
      const getField = (...keys: string[]): unknown => {
        // Case-insensitive + collapse internal/edge whitespace, so "Full  Name",
        // " Patient ", and "patient" all match the same column.
        const normalizedKeys = keys.map((key) => key.trim().toLowerCase().replace(/\s+/g, " "));
        const entry = Object.entries(candidate).find(([key]) =>
          normalizedKeys.includes(key.trim().toLowerCase().replace(/\s+/g, " ")),
        );
        return entry?.[1];
      };
      const text = (...keys: string[]) => toTextField(getField(...keys));

      const name = text("Full Name", "name", "patient name", "patient_name", "patient");
      const phoneRaw = text("Contact no", "phone", "phone number", "phone_number", "contact", "contact number", "mobile");
      const email = text("Email", "email", "email id", "email_id", "mail");

      // Skip blank filler rows (headers repeated mid-sheet, empty lines, etc.)
      // so they never become junk "-" leads in the database.
      if (!name && !phoneRaw && !email) {
        skippedRows += 1;
        continue;
      }

      // Optional columns: if the spreadsheet does not have them at all,
      // toTextField returns "" and dashIfEmpty turns that into "-".
      const importedDate = getField(
        "Date",
        "date",
        "Lead Date",
        "lead_date",
        "Date of Lead",
        "date_of_lead",
        "created at",
        "created_at",
      );
      const followUpDate = getField(
        "Follow-up Date",
        "follow_up_date",
        "Follow Up Date",
        "followup_date",
        "Next Follow Up",
        "next_follow_up",
      );
      const importedAssignee = text("Assigned To", "assigned_to", "assign to", "assign_to");
      const assignedProfileName = importedAssignee
        ? validProfileNames.get(importedAssignee.toLowerCase()) ?? "-"
        : "-";

      records.push({
        name: dashIfEmpty(name),
        phone: sanitizePhone(phoneRaw),
        email: dashIfEmpty(email),
        gender: dashIfEmpty(text("Gender", "gender")),
        // CRITICAL: city/location/area/address all funnel into the dedicated city column.
        city: dashIfEmpty(text("City", "city", "Location", "location", "Area", "area", "Address", "address")),
        disease: dashIfEmpty(text("Disease", "disease", "Treatment", "treatment", "Issue", "issue", "Problem", "problem", "Health Concern")),
        insurance_status: dashIfEmpty(text("Insurance Status", "insurance_status", "insurance")),
        remarks: dashIfEmpty(text("Remark 1", "remarks", "remark", "Remark", "note", "notes", "comment", "comments")),
        lead_date: parseLeadDate(importedDate),
        follow_up_date: dashIfEmpty(toTextField(followUpDate)),
        source: batchSource,
        status: dashIfEmpty(text("Lead Status", "status", "lead_status")),
        temperature: "Warm",
        assigned_to: assignedProfileName,
      });
    } catch (rowError) {
      // One malformed row must never crash the whole import.
      console.error("[bulkInsertLeads] Skipping malformed row", {
        fileName,
        error: rowError instanceof Error ? rowError.message : rowError,
      });
      skippedRows += 1;
    }
  }

  if (records.length === 0) {
    return {
      success: false,
      error:
        skippedRows > 0
          ? `No valid leads were found in the import (${skippedRows} rows were skipped as invalid or empty).`
          : "No valid leads were found in the import.",
    };
  }

  // ---- Duplicate prevention (phone-number based) ----
  // 1) Dedupe within the uploaded file itself: the first row with a given
  //    phone wins, later rows with the same number are ignored.
  const seenFilePhones = new Set<string>();
  let duplicateRows = 0;
  const uniqueRecords = records.filter((record) => {
    const phoneDigits = normalizePhoneDigits(record.phone);
    if (!phoneDigits) return true; // No phone to compare — keep the lead.
    if (seenFilePhones.has(phoneDigits)) {
      duplicateRows += 1;
      return false;
    }
    seenFilePhones.add(phoneDigits);
    return true;
  });

  // 2) Skip leads whose phone number ALREADY EXISTS in the database.
  //    Existing phones are fetched in bounded chunks so the query URL never
  //    exceeds PostgREST limits, even for uploads with thousands of rows.
  let skippedDuplicates = duplicateRows;
  const filePhones = [...seenFilePhones];
  const existingPhoneSet = new Set<string>();
  const phoneChunkSize = 500;
  for (let index = 0; index < filePhones.length; index += phoneChunkSize) {
    const chunk = filePhones.slice(index, index + phoneChunkSize);
    const { data: existingPhones, error: existingError } = await supabase
      .from("leads")
      .select("phone")
      .in("phone", chunk);
    if (existingError) {
      return { success: false, error: existingError.message };
    }
    for (const row of existingPhones ?? []) {
      const digits = normalizePhoneDigits(String(row.phone ?? ""));
      if (digits) existingPhoneSet.add(digits);
    }
  }

  const freshRecords = uniqueRecords.filter((record) => {
    const phoneDigits = normalizePhoneDigits(record.phone);
    if (phoneDigits && existingPhoneSet.has(phoneDigits)) {
      skippedDuplicates += 1;
      return false;
    }
    return true;
  });

  if (freshRecords.length === 0) {
    return {
      success: true,
      data: { leads: [], skippedDuplicates, skippedRows },
    };
  }

  // Insert in bounded chunks so very large files never exceed PostgREST
  // request limits, and always send exactly the leads-table columns.
  const chunkSize = 500;
  const insertedLeads: Lead[] = [];
  try {
    for (let index = 0; index < freshRecords.length; index += chunkSize) {
      const chunk = freshRecords
        .slice(index, index + chunkSize)
        .map((record) => pickLeadColumns(record as unknown as Record<string, unknown>));
      const { data, error } = await supabase
        .from("leads")
        .insert(chunk)
        .select();

      if (error) {
        const from = index + 1;
        const to = Math.min(index + chunkSize, freshRecords.length);
        const saved = insertedLeads.length > 0 ? `${insertedLeads.length} leads were saved before the failure. ` : "";
        return {
          success: false,
          error: `${saved}Rows ${from}-${to} failed: ${error.message}`,
        };
      }

      insertedLeads.push(...((data ?? []) as Lead[]));
    }

    revalidatePath("/dashboard");
    return { success: true, data: { leads: insertedLeads, skippedDuplicates, skippedRows } };
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
  deleteAll = false,
  search = "",
  assignedTo = "",
): Promise<ActionResult<{ deleted: number }>> {
  if (!deleteAll && leadIds.length === 0) return { success: false, error: "No leads selected." };

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "You must be signed in." };

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (profile?.role !== "admin") {
      return { success: false, error: "Deleting leads is restricted to admins (403 Forbidden)." };
    }

    if (deleteAll) {
      // "Select All" delete: wipe leads with ONE query instead of shipping a
      // 1k+ element ID array that overflows serverless payload limits
      // (HTTP 400). lead_activities rows are removed automatically via the
      // ON DELETE CASCADE foreign key. Note: leads.id is a uuid, so the
      // always-true filter uses `.not("id", "is", null)` rather than `.neq("id", 0)`.
      // When a server-side search is active, only leads matching that search
      // are wiped, so "Select All" never deletes more than what is visible.
      const searchFilter = buildLeadSearchFilter(search);
      const isScoped = Boolean(assignedTo.trim());

      // Scope: a specific employee (admin drill-down) + optional search, or
      // the whole table when neither is provided.
      const countQuery = supabase.from("leads").select("id", { count: "exact", head: true });
      if (isScoped) countQuery.eq("assigned_to", assignedTo.trim());
      if (searchFilter) countQuery.or(searchFilter);
      const { count: total, error: countError } = await countQuery;
      if (countError) return { success: false, error: countError.message };

      const deleteQuery = supabase.from("leads").delete();
      if (isScoped) deleteQuery.eq("assigned_to", assignedTo.trim());
      else if (!searchFilter) deleteQuery.not("id", "is", null);
      if (searchFilter) deleteQuery.or(searchFilter);
      const { error } = await deleteQuery;
      if (error) return { success: false, error: error.message };

      revalidatePath("/dashboard");
      return { success: true, data: { deleted: total ?? 0 } };
    }

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

    // RBAC: only Admins and Managers can distribute leads.
    const viewerRole = await getViewerRole(supabase);
    if (!viewerRole || viewerRole === "employee") {
      return { success: false, error: "Only admins and managers can distribute leads (403 Forbidden)." };
    }

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

export interface SmartAssignmentResult {
  assigned: number;
  perEmployee: { name: string; count: number }[];
}

// Smart Bulk Assignment: assigns up to `count` unassigned leads, split EQUALLY
// among the selected employees (any remainder is handed out 1-by-1 to the
// first employees in the selection). Admin/Manager only.
export async function assignUnassignedLeads(
  count: number,
  employeeNames: string[],
): Promise<ActionResult<SmartAssignmentResult>> {
  const targetCount = Math.floor(Number(count) || 0);
  const selectedNames = Array.from(
    new Set(
      (employeeNames ?? [])
        .map((name) => (typeof name === "string" ? name.trim() : ""))
        .filter(Boolean),
    ),
  );
  if (targetCount < 1) {
    return { success: false, error: "Specify how many leads to assign (at least 1)." };
  }
  if (selectedNames.length === 0) {
    return { success: false, error: "Select at least one employee to assign leads to." };
  }

  try {
    const supabase = await createClient();

    // RBAC: only Admins and Managers can assign leads.
    const viewerRole = await getViewerRole(supabase);
    if (!viewerRole || viewerRole === "employee") {
      return { success: false, error: "Only admins and managers can assign leads (403 Forbidden)." };
    }

    // Validate the selected employees against the profiles table.
    const { data: profiles, error: profilesError } = await supabase.from("profiles").select("name");
    if (profilesError) return { success: false, error: profilesError.message };
    const validNames = new Set(
      (profiles ?? [])
        .map((profile) => (typeof profile.name === "string" ? profile.name.trim() : ""))
        .filter(Boolean),
    );
    const targets = selectedNames.filter((name) => validNames.has(name));
    if (targets.length === 0) {
      return { success: false, error: "None of the selected employees exist. Refresh and try again." };
    }

    // Fetch the requested number of unassigned leads (oldest first).
    const { data: unassignedLeads, error: fetchError } = await supabase
      .from("leads")
      .select("id")
      .eq("assigned_to", "-")
      .order("created_at", { ascending: true })
      .limit(targetCount);
    if (fetchError) return { success: false, error: fetchError.message };
    const leadIds = (unassignedLeads ?? []).map((row) => String(row.id)).filter(Boolean);
    if (leadIds.length === 0) {
      return { success: false, error: "No unassigned leads are available to assign." };
    }

    // Equal split: everyone gets `base`, the first `remainder` get one extra.
    const base = Math.floor(leadIds.length / targets.length);
    const remainder = leadIds.length % targets.length;
    const perEmployee: { name: string; count: number; leadIds: string[] }[] = [];
    let cursor = 0;
    targets.forEach((name, index) => {
      const share = base + (index < remainder ? 1 : 0);
      const ids = leadIds.slice(cursor, cursor + share);
      cursor += share;
      perEmployee.push({ name, count: ids.length, leadIds: ids });
    });

    // Bulk update per employee, chunked so `.in()` never exceeds URL limits.
    const chunkSize = 500;
    let assigned = 0;
    for (const entry of perEmployee) {
      for (let index = 0; index < entry.leadIds.length; index += chunkSize) {
        const chunk = entry.leadIds.slice(index, index + chunkSize);
        if (chunk.length === 0) continue;
        const { error } = await supabase
          .from("leads")
          .update({ assigned_to: entry.name })
          .in("id", chunk);
        if (error) {
          return {
            success: false,
            error: `Assigned ${assigned} leads before failing: ${error.message}`,
          };
        }
        assigned += chunk.length;
      }
    }

    revalidatePath("/dashboard");
    return {
      success: true,
      data: {
        assigned,
        perEmployee: perEmployee
          .filter((entry) => entry.count > 0)
          .map(({ name, count: employeeCount }) => ({ name, count: employeeCount })),
      },
    };
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

    // RBAC: employees cannot reassign leads (assigned_to is a core field).
    const viewerRole = await getViewerRole(supabase);
    if (!viewerRole || viewerRole === "employee") {
      return { success: false, error: "Only admins and managers can reassign leads (403 Forbidden)." };
    }

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

export interface UpdateLeadDetailsInput {
  id: string;
  name?: string;
  phone?: string;
  email?: string;
  gender?: string;
  city?: string;
  disease?: string;
  insurance_status?: string;
  remarks?: string;
  status?: string;
  temperature?: string;
  assigned_to?: string;
  lead_date?: string;
  follow_up_date?: string;
}

// Full editability: lets admins edit every field of a lead directly from the
// dashboard UI (employees can edit their own leads per RLS). Only fields that
// are present in the input are updated.
export async function updateLeadDetails(
  input: UpdateLeadDetailsInput,
): Promise<ActionResult<Lead>> {
  if (!input.id) {
    return { success: false, error: "Lead ID is required." };
  }

  const updates: Record<string, string> = {};
  if (input.name !== undefined) updates.name = input.name.trim() || "-";
  if (input.phone !== undefined) updates.phone = sanitizePhone(input.phone);
  if (input.email !== undefined) updates.email = input.email.trim() || "-";
  if (input.gender !== undefined) updates.gender = input.gender.trim() || "-";
  if (input.city !== undefined) updates.city = input.city.trim() || "-";
  if (input.disease !== undefined) updates.disease = input.disease.trim() || "-";
  if (input.insurance_status !== undefined) updates.insurance_status = input.insurance_status.trim() || "-";
  if (input.remarks !== undefined) updates.remarks = input.remarks.trim() || "-";
  if (input.status !== undefined && input.status.trim()) updates.status = input.status.trim();
  if (input.temperature !== undefined && input.temperature.trim()) updates.temperature = input.temperature.trim();
  if (input.assigned_to !== undefined) updates.assigned_to = input.assigned_to.trim() || "-";
  if (input.lead_date !== undefined) updates.lead_date = input.lead_date.trim() || "-";
  if (input.follow_up_date !== undefined) updates.follow_up_date = input.follow_up_date.trim() || "-";

  if (Object.keys(updates).length === 0) {
    return { success: false, error: "No changes were provided." };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return { success: false, error: "You must be signed in to edit leads." };
    }

    // RBAC enforcement: employees may only update Status / Temperature /
    // Remarks. Core fields (name, contact, email, city, treatment, dates,
    // assignment) are stripped from their requests even if tampered with.
    const { data: viewerProfile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (viewerProfile?.role === "employee") {
      const allowed = new Set(["status", "temperature", "remarks"]);
      for (const key of Object.keys(updates)) {
        if (!allowed.has(key)) delete updates[key];
      }
      if (Object.keys(updates).length === 0) {
        return { success: false, error: "You can only update Status, Temperature and Remarks." };
      }
    }

    // Keep the phone number unique across leads, same rule as the import.
    if (updates.phone) {
      const { data: duplicate, error: duplicateError } = await supabase
        .from("leads")
        .select("id")
        .eq("phone", updates.phone)
        .neq("id", input.id)
        .limit(1);
      if (duplicateError) return { success: false, error: duplicateError.message };
      if (duplicate && duplicate.length > 0) {
        return { success: false, error: "Another lead already has this phone number." };
      }
    }

    const { data, error } = await supabase
      .from("leads")
      .update(updates)
      .eq("id", input.id)
      .select()
      .single();

    if (error) return { success: false, error: error.message };
    revalidatePath("/dashboard");
    return { success: true, data: data as Lead };
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error, "Unable to update lead details."),
    };
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
