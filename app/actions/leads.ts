"use server";

import { revalidatePath } from "next/cache";

import {
  ageBucketWindow,
  andClauses,
  blankColumnClause,
  EMPTY_LEAD_FILTERS,
  escapeLikePattern,
  inListExpression,
  isUnrecordedTreatment,
  stageFilterKeys,
  tallyTreatments,
  treatmentOrExpression,
  UNRECORDED_TREATMENT_VALUES,
  type AgeWindow,
  type LeadListFilters,
  type TreatmentTally,
} from "@/app/dashboard/lead-filters";
import {
  PIPELINE_STAGES,
  SEGMENT_LEAD_LIMIT,
  STAGE_TARGET_STATUS,
  UNRECORDED_TREATMENT_KEY,
  canonicalTreatment,
  detectTreatmentName,
  stageForStatus,
  toAnalyticsLead,
  type StageKey,
} from "@/app/dashboard/overview/analytics";
import {
  DELETE_ALL_CONFIRMATION,
  isMissingBackupTableError,
  LEAD_DELETION_BACKUP_SETUP_HINT,
  type LeadDeletionBackup,
} from "@/lib/lead-deletion";
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

// NOTE: the old `getLeads()` (which fetched every column with `select('*')`)
// was removed — analytics pages must use `getAnalyticsLeads()` below, and the
// paginated table uses `getLeadsPage()`.

// ---------------------------------------------------------------------------
// Light analytics projection
//
// The overview/analysis pages never use `select('*')`. This action requests
// only the columns the dashboard cards actually read, which keeps the network
// payload tiny even with tens of thousands of leads:
//
//   status           → KPIs, month trend, stage/pipeline grouping
//   treatment_type   → LASIK / Cataract / ICL grouping (probed, see below)
//   lead_date, created_at → month-by-month trend (lead_date preferred)
//   city             → "Top Cities" chart
//   source           → "Lead Source Performance" chart + filter
//   temperature      → agent hot/warm/cold chips
//   assigned_to      → agent roster + agent filter
//   name, disease    → patients table / legacy treatment fallback
const ANALYTICS_BASE_COLUMNS =
  "id, name, city, disease, source, status, temperature, assigned_to, lead_date, created_at";

// Every column that could hold the treatment / procedure text. Each candidate is
// probed once per server process and ALL that exist are selected, so a CRM
// whose treatment lives in `disease` (or a custom `surgery_type`) still feeds the
// pipeline chart instead of rendering one solid "Other" bar.
const ANALYTICS_TREATMENT_COLUMNS = [
  "treatment_type",
  "treatment",
  "treatment_name",
  "surgery_type",
  "surgery",
  "procedure",
] as const;

let treatmentColumnsCache: string[] | null = null;

async function resolveTreatmentColumns(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string[]> {
  if (treatmentColumnsCache) return treatmentColumnsCache;
  // Probed in parallel (then cached for the process) so the first dashboard load
  // pays one round-trip, not six.
  const results = await Promise.all(
    ANALYTICS_TREATMENT_COLUMNS.map(async (candidate): Promise<string | null> => {
      // PostgREST rejects unknown columns, so `error === null` means it exists.
      const { error } = await supabase.from("leads").select(candidate).limit(1);
      return error ? null : candidate;
    }),
  );
  treatmentColumnsCache = results.filter((candidate): candidate is string => candidate !== null);
  return treatmentColumnsCache;
}

/** All leads (RLS-scoped) for the dashboard, projected to the analytics columns only. */
export async function getAnalyticsLeads(): Promise<ActionResult<Lead[]>> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { success: true, data: [] };

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("name, role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) return { success: true, data: [] };
    if (profile.role === "employee" && !profile.name?.trim()) return { success: true, data: [] };

    // Select the base columns plus every treatment column the table actually has
    // (treatment_type / treatment / treatment_name / surgery_type / ...). This is
    // what feeds the LASIK / Cataract / ICL segments of the pipeline chart.
    const treatmentColumns = await resolveTreatmentColumns(supabase);
    const columns = [ANALYTICS_BASE_COLUMNS, ...treatmentColumns].join(", ");

    let query = supabase.from("leads").select(columns).order("created_at", { ascending: false });
    if (profile.role === "employee") query = query.ilike("assigned_to", profile.name);

    const { data, error } = await query;
    if (error) return { success: false, error: error.message };

    return { success: true, data: (data ?? []) as unknown as Lead[] };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Unable to fetch analytics leads.") };
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

// ---------------------------------------------------------------------------
// Kanban board ("pipeline at a glance")
// ---------------------------------------------------------------------------

/**
 * The fields a board card renders. Deliberately a SHORT projection: a board can
 * show hundreds of cards, and pulling `select("*")` for all of them is exactly
 * the kind of egress the free tier hates.
 */
export interface BoardLead {
  id: string;
  name: string;
  phone: string | null;
  city: string;
  disease: string;
  status: LeadStatus;
  temperature: LeadTemperature;
  assigned_to: string | null;
  follow_up_date: string;
  created_at: string;
}

export interface BoardColumn {
  key: StageKey;
  label: string;
  /** Status written when a card is dropped here (see STAGE_TARGET_STATUS). */
  status: string;
  /** Exact number of leads in this stage for the viewer (not the card count). */
  total: number;
  leads: BoardLead[];
}

export interface PipelineBoardData {
  columns: BoardColumn[];
  total: number;
  /** Cards returned per column; `total` may be larger ("N more" hint in the UI). */
  cardLimit: number;
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

// ---------------------------------------------------------------------------
// Chart drill-down filters (?stage= &treatment= &age= &city= ... on
// /dashboard/leads). Stage and treatment grouping reuse the SAME JS helpers the
// charts use (stageForStatus / canonicalTreatment), fed by the distinct values
// that currently exist in the table — so a drill-down list always agrees with
// the bar that was clicked.
// ---------------------------------------------------------------------------

type LeadsSupabaseClient = Awaited<ReturnType<typeof createClient>>;

const DISTINCT_CACHE_TTL_MS = 60_000;
const DISTINCT_ROW_LIMIT = 20_000;

interface TreatmentValue {
  column: string;
  value: string;
  /** Series key the charts group this raw text into. */
  key: string;
}

// Deciding "which rows belong to this segment" needs the whole table's distinct
// statuses / treatment texts, so those two lists are fetched once a minute
// instead of once per page.
let distinctStatusCache: { values: string[]; at: number } | null = null;
let distinctTreatmentCache: { values: TreatmentValue[]; at: number } | null = null;

/** Distinct `status` values; `null` = query failed → the stage filter is skipped. */
async function getDistinctStatuses(supabase: LeadsSupabaseClient): Promise<string[] | null> {
  if (distinctStatusCache && Date.now() - distinctStatusCache.at < DISTINCT_CACHE_TTL_MS) {
    return distinctStatusCache.values;
  }
  const { data, error } = await supabase.from("leads").select("status").limit(DISTINCT_ROW_LIMIT);
  if (error) return distinctStatusCache?.values ?? null;
  const values = [...new Set((data ?? []).map((row) => row.status?.trim() ?? ""))];
  distinctStatusCache = { values, at: Date.now() };
  return values;
}

/** Distinct treatment text per column, each mapped to its chart series key. */
async function getDistinctTreatmentValues(supabase: LeadsSupabaseClient): Promise<TreatmentValue[] | null> {
  if (distinctTreatmentCache && Date.now() - distinctTreatmentCache.at < DISTINCT_CACHE_TTL_MS) {
    return distinctTreatmentCache.values;
  }
  const treatmentColumns = await resolveTreatmentColumns(supabase);
  const columns = [...new Set(["disease", "remarks", ...treatmentColumns])];
  const { data, error } = await supabase.from("leads").select(columns.join(", ")).limit(DISTINCT_ROW_LIMIT);
  if (error) return distinctTreatmentCache?.values ?? null;
  const seen = new Set<string>();
  const values: TreatmentValue[] = [];
  for (const row of data ?? []) {
    // The select string is built at runtime, so Supabase types each cell as a
    // parse-error sentinel — read them as plain records instead.
    const record = row as unknown as Record<string, unknown>;
    for (const column of columns) {
      const cell = record[column];
      const raw = typeof cell === "string" ? cell.trim() : "";
      const id = column + "|" + raw;
      if (seen.has(id)) continue;
      seen.add(id);
      if (column === "remarks") {
        // Free-text notes only ever contribute a RECOGNISED treatment name —
        // the chart never lets a random remark become its own series.
        const detected = detectTreatmentName(raw);
        if (detected) values.push({ column, value: raw, key: canonicalTreatment(detected).key });
        continue;
      }
      values.push({ column, value: raw, key: canonicalTreatment(raw).key });
    }
  }
  distinctTreatmentCache = { values, at: Date.now() };
  return values;
}

/** The resolved drill-down filters, ready to chain onto any leads query. */
interface ResolvedLeadFilters {
  /** No row can match — the caller short-circuits with an empty page. */
  empty: boolean;
  inFilters: { column: string; values: string[] }[];
  orExpressions: string[];
  ageWindow: AgeWindow | null;
  city: string | null;
  source: string | null;
  assigned: string | null;
}

function emptyResolvedFilters(): ResolvedLeadFilters {
  return {
    empty: false,
    inFilters: [],
    orExpressions: [],
    ageWindow: null,
    city: null,
    source: null,
    assigned: null,
  };
}

/**
 * Minimal structural view of the PostgREST builder so ONE helper can filter
 * both the paginated page query and the CSV export query.
 */
interface LeadFilterQuery<Q> {
  in(column: string, values: readonly string[]): Q;
  or(filters: string): Q;
  ilike(column: string, pattern: string): Q;
  gte(column: string, value: string): Q;
  lt(column: string, value: string): Q;
  eq(column: string, value: string): Q;
}

function applyLeadFilters<Q extends LeadFilterQuery<Q>>(query: Q, resolved: ResolvedLeadFilters): Q {
  let filtered = query;
  for (const filter of resolved.inFilters) filtered = filtered.in(filter.column, filter.values);
  // Every entry is its own `or=(...)` param, so separate entries AND together
  // (stage AND treatment AND age ...).
  for (const expression of resolved.orExpressions) filtered = filtered.or(expression);
  if (resolved.ageWindow) {
    if (resolved.ageWindow.fromIso) filtered = filtered.gte("created_at", resolved.ageWindow.fromIso);
    if (resolved.ageWindow.toIso) filtered = filtered.lt("created_at", resolved.ageWindow.toIso);
  }
  if (resolved.city) filtered = filtered.ilike("city", resolved.city);
  if (resolved.source) filtered = filtered.ilike("source", resolved.source);
  if (resolved.assigned) filtered = filtered.eq("assigned_to", resolved.assigned);
  return filtered;
}

/**
 * Turns URL drill-down filters into PostgREST conditions. Runs two extra
 * (cached, light) queries so `stage` and `treatment` resolve with EXACTLY the
 * grouping the dashboard charts perform in the browser.
 */
async function resolveLeadFilters(
  supabase: LeadsSupabaseClient,
  filters?: Partial<LeadListFilters>,
): Promise<ResolvedLeadFilters> {
  const resolved = emptyResolvedFilters();
  if (!filters) return resolved;

  const stageKeys = stageFilterKeys(filters.stage ?? "");
  const treatment = (filters.treatment ?? "").trim();
  const age = (filters.age ?? "").trim();
  const city = (filters.city ?? "").trim();
  const source = (filters.source ?? "").trim();
  const assigned = (filters.assigned ?? "").trim();
  if (stageKeys.length === 0 && !treatment && !age && !city && !source && !assigned) return resolved;

  // --- Stage: run every distinct status through stageForStatus() (the exact
  // function the pipeline chart uses), then ask Postgres for those statuses.
  if (stageKeys.length > 0) {
    const statuses = await getDistinctStatuses(supabase);
    if (statuses) {
      const wanted = new Set<string>(stageKeys);
      const matching = statuses.filter((value) => wanted.has(stageForStatus(value)));
      if (matching.length === 0) {
        resolved.empty = true;
      } else if (matching.includes("")) {
        // Blank AND NULL statuses both read as stage "new".
        resolved.orExpressions.push(`status.is.null,status.in.(${inListExpression(matching)})`);
      } else {
        resolved.inFilters.push({ column: "status", values: matching });
      }
    }
  }

  // --- Age bucket → created_at window (server-local calendar; see ageBucketWindow).
  if (age) resolved.ageWindow = ageBucketWindow(age);

  // --- Treatment: map raw treatment text onto the chart's series key.
  if (treatment && !resolved.empty) {
    const treatmentColumns = await resolveTreatmentColumns(supabase);
    // Same priority order resolveTreatmentText() walks: candidates first, `disease` last.
    const priorityColumns = [...new Set([...treatmentColumns, "disease"])];
    const values = await getDistinctTreatmentValues(supabase);

    if (isUnrecordedTreatment(treatment)) {
      // "Not Recorded" = every treatment column still a placeholder AND the
      // remarks name no treatment.
      const clauses = priorityColumns.map(
        (column) => `or(${column}.is.null,${column}.in.(${inListExpression(UNRECORDED_TREATMENT_VALUES)}))`,
      );
      const remarksWithTreatment = (values ?? [])
        .filter((entry) => entry.column === "remarks")
        .map((entry) => entry.value);
      if (remarksWithTreatment.length > 0) {
        clauses.push(`or(remarks.is.null,not.or(remarks.in.(${inListExpression(remarksWithTreatment)}))))`);
      }
      resolved.orExpressions.push(clauses.length === 1 ? clauses[0] : `and(${clauses.join(",")})`);
    } else if (values) {
      const except = new Set((filters.except ?? "").split(",").map((key) => key.trim()).filter(Boolean));
      const wanted = (key: string) =>
        treatment === "other" ? key !== UNRECORDED_TREATMENT_KEY && !except.has(key) : key === treatment;
      const byColumn = new Map<string, string[]>();
      const remarks: string[] = [];
      for (const entry of values) {
        if (!wanted(entry.key)) continue;
        if (entry.column === "remarks") remarks.push(entry.value);
        else byColumn.set(entry.column, [...(byColumn.get(entry.column) ?? []), entry.value]);
      }
      const clauses: string[] = [];
      priorityColumns.forEach((column, index) => {
        const matches = byColumn.get(column);
        if (!matches?.length) return;
        // A row only reads this column when every HIGHER-priority column is blank.
        const guards = priorityColumns.slice(0, index).map(blankColumnClause);
        clauses.push(andClauses([`${column}.in.(${inListExpression(matches)})`, ...guards]));
      });
      if (remarks.length > 0) {
        // A remark only counts when no treatment column has a real value.
        clauses.push(
          andClauses([`remarks.in.(${inListExpression(remarks)})`, ...priorityColumns.map(blankColumnClause)]),
        );
      }
      if (clauses.length === 0) resolved.empty = true;
      else resolved.orExpressions.push(clauses.length === 1 ? clauses[0] : `or(${clauses.join(",")})`);
    } else {
      // Distinct values unavailable → keyword fallback (best-effort SQL mirror).
      const patterns = treatmentOrExpression(treatment, [...priorityColumns, "remarks"]);
      if (patterns) resolved.orExpressions.push(patterns);
      else resolved.empty = true;
    }
  }

  // --- Exact-match filters: ilike without wildcards = case-insensitive equality.
  if (city) resolved.city = escapeLikePattern(city);
  if (source) resolved.source = escapeLikePattern(source);
  if (assigned) resolved.assigned = assigned;

  return resolved;
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
  filters?: Partial<LeadListFilters>,
  leadIds?: string[],
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

    // Drill-down filters from the dashboard charts (stage/treatment/age/city).
    // `empty` means no row can possibly match — skip the round-trip entirely.
    const resolved = await resolveLeadFilters(supabase, filters);
    if (resolved.empty) {
      return { success: true, data: { leads: [], total: 0, page: 1, pageSize: safePageSize, totalPages: 1 } };
    }

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
    // Exact-id prefetch: the segment detail dialog asks for "these 25 ids".
    // Ids are UUIDs returned by our own tally, so `in` is safe here.
    if (leadIds && leadIds.length > 0) {
      leadsQuery = leadsQuery.in("id", leadIds.slice(0, SEGMENT_LEAD_LIMIT));
    }
    // ?status= from the URL folds into the existing advanced status filter.
    const effectiveStatus = statusFilter.trim() || (filters?.status ?? "").trim();
    const statusFilterNormalized = effectiveStatus.toLowerCase();
    if (statusFilterNormalized) {
      // Advanced status filter: Hot/Warm/Cold target the temperature column,
      // every other value (New, OPD Done, Won, Lost, ...) targets status.
      leadsQuery = TEMPERATURE_FILTERS.has(statusFilterNormalized)
        ? leadsQuery.eq("temperature", effectiveStatus)
        : leadsQuery.eq("status", effectiveStatus);
    }
    leadsQuery = applyLeadFilters(leadsQuery, resolved);
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
// employee drill-down + chart drill-down filters), capped at EXPORT_LIMIT rows.
export async function getLeadsForExport(
  search = "",
  statusFilter = "",
  assignedTo = "",
  filters?: Partial<LeadListFilters>,
  // Optional explicit id list — used by the pre-delete safety copy, which has to
  // fetch exactly the ticked rows (even when they span several pages).
  ids?: string[],
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

    const resolved = await resolveLeadFilters(supabase, filters);
    if (resolved.empty) return { success: true, data: [] };

    let exportQuery = supabase.from("leads").select("*");
    if (ids && ids.length > 0) exportQuery = exportQuery.in("id", ids);
    if (assignedTo.trim()) exportQuery = exportQuery.eq("assigned_to", assignedTo.trim());
    const searchFilter = buildLeadSearchFilter(search);
    if (searchFilter) exportQuery = exportQuery.or(searchFilter);
    const effectiveStatus = statusFilter.trim() || (filters?.status ?? "").trim();
    const statusFilterNormalized = effectiveStatus.toLowerCase();
    if (statusFilterNormalized) {
      exportQuery = TEMPERATURE_FILTERS.has(statusFilterNormalized)
        ? exportQuery.eq("temperature", effectiveStatus)
        : exportQuery.eq("status", effectiveStatus);
    }
    exportQuery = applyLeadFilters(exportQuery, resolved);
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
/**
 * Treatment-wise tally for the leads page — "konsa lead kis treatment / disease
 * ka hai" at a glance.
 *
 * Reuses the LIGHT analytics projection (no `select('*')`) and groups in JS with
 * the exact helpers the pipeline chart uses, so the chip counts and the chart
 * bars can never disagree. At a few hundred / few thousand rows this is one cheap
 * query; past that, move it into a Postgres aggregate (see
 * docs/GROWTH-AND-COSTS.md → "lead_rollup").
 */
export async function getTreatmentTally(
  filters?: Partial<LeadListFilters>,
): Promise<ActionResult<TreatmentTally[]>> {
  const result = await getAnalyticsLeads();
  if (!result.success) return result;
  const resolved: LeadListFilters = { ...EMPTY_LEAD_FILTERS, ...filters };
  return { success: true, data: tallyTreatments(result.data.map(toAnalyticsLead), resolved) };
}

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

// ---------------------------------------------------------------------------
// Kanban board
// ---------------------------------------------------------------------------

// Cards per column. The header always shows the EXACT stage count, so a long
// column stays honest instead of pretending 40 cards is the whole stage.
const BOARD_CARD_LIMIT = 40;
const BOARD_CARD_COLUMNS =
  "id, name, phone, city, disease, status, temperature, assigned_to, follow_up_date, created_at";

const BOARD_COLUMNS: { key: StageKey; label: string }[] = [
  ...PIPELINE_STAGES,
  { key: "lost", label: "Lost / Dropped" },
];

function emptyBoardData(): PipelineBoardData {
  return {
    columns: BOARD_COLUMNS.map(({ key, label }) => ({
      key,
      label,
      status: STAGE_TARGET_STATUS[key],
      total: 0,
      leads: [],
    })),
    total: 0,
    cardLimit: BOARD_CARD_LIMIT,
  };
}

/**
 * Feeds the Kanban board: one light query per column (cards + an exact count),
 * scoped exactly like every other list — employees only ever see leads assigned
 * to them, and RLS enforces the same rule underneath.
 */
export async function getPipelineBoard(): Promise<ActionResult<PipelineBoardData>> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { success: true, data: emptyBoardData() };

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("name, role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) return { success: true, data: emptyBoardData() };
    if (profile.role === "employee" && !profile.name?.trim()) {
      return { success: true, data: emptyBoardData() };
    }

    const isEmployee = profile.role === "employee";
    const employeeName = profile.name ?? "";

    const columns = await Promise.all(
      BOARD_COLUMNS.map(async ({ key, label }) => {
        const status = STAGE_TARGET_STATUS[key];
        const resolved = await resolveLeadFilters(supabase, { stage: key });
        if (resolved.empty) return { key, label, status, total: 0, leads: [] as BoardLead[] };

        const cardsQuery = supabase.from("leads").select(BOARD_CARD_COLUMNS);
        const countQuery = supabase.from("leads").select("id", { count: "exact", head: true });

        const scopedCards = isEmployee ? cardsQuery.ilike("assigned_to", employeeName) : cardsQuery;
        const scopedCount = isEmployee ? countQuery.ilike("assigned_to", employeeName) : countQuery;

        const [cardsResult, countResult] = await Promise.all([
          applyLeadFilters(scopedCards, resolved)
            .order("created_at", { ascending: false })
            .limit(BOARD_CARD_LIMIT),
          applyLeadFilters(scopedCount, resolved),
        ]);

        const failure = cardsResult.error ?? countResult.error;
        if (failure) throw new Error(failure.message);

        return {
          key,
          label,
          status,
          total: countResult.count ?? 0,
          leads: (cardsResult.data ?? []) as unknown as BoardLead[],
        };
      }),
    );

    return {
      success: true,
      data: {
        columns,
        total: columns.reduce((sum, column) => sum + column.total, 0),
        cardLimit: BOARD_CARD_LIMIT,
      },
    };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Unable to load the pipeline board.") };
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

// ---------------------------------------------------------------------------
// Employee directory (with optional HR details)
// ---------------------------------------------------------------------------

export interface EmployeeDirectoryEntry {
  id: string;
  name: string;
  role: "admin" | "manager" | "employee";
  phone: string | null;
  email: string | null;
  gender: string | null;
  blood_group: string | null;
  emergency_contact: string | null;
  manager_name: string | null;
  photo_url: string | null;
}

// The HR columns are optional. The query below selects them when the optional
// HR migration (supabase-hr-migration.sql) has been applied and silently falls
// back to the three base columns when it has not (PostgREST answers 42703 /
// PGRST204 for unknown columns), so the CRM keeps working either way.
const HR_PROFILE_COLUMNS =
  "id, name, role, phone, email, gender, blood_group, emergency_contact, manager_name, photo_url";
const BASE_PROFILE_COLUMNS = "id, name, role";

function textOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed !== "-" ? trimmed : null;
}

export async function getEmployeeDirectory(): Promise<ActionResult<EmployeeDirectoryEntry[]>> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { success: true, data: [] };

    // RBAC: the HR-aware directory (contact numbers, blood group, manager) is an
    // admin/manager capability. Employees get an empty roster instead of the
    // company-wide contact sheet.
    const viewerRole = await getViewerRole(supabase);
    if (!viewerRole || viewerRole === "employee") return { success: true, data: [] };

    const withHr = await supabase.from("profiles").select(HR_PROFILE_COLUMNS).order("name", { ascending: true });
    let rows = (withHr.data ?? null) as Record<string, unknown>[] | null;

    if (withHr.error) {
      const base = await supabase.from("profiles").select(BASE_PROFILE_COLUMNS).order("name", { ascending: true });
      if (base.error) return { success: false, error: base.error.message };
      rows = (base.data ?? null) as Record<string, unknown>[] | null;
    }

    return {
      success: true,
      data: (rows ?? []).map((row) => ({
        id: String(row.id ?? ""),
        name: String(row.name ?? "").trim(),
        role: row.role === "admin" || row.role === "manager" ? row.role : "employee",
        phone: textOrNull(row.phone),
        email: textOrNull(row.email),
        gender: textOrNull(row.gender),
        blood_group: textOrNull(row.blood_group),
        emergency_contact: textOrNull(row.emergency_contact),
        manager_name: textOrNull(row.manager_name),
        photo_url: textOrNull(row.photo_url),
      })),
    };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Unable to fetch the employee directory.") };
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
  // Imported rows that got no agent (the sheet had no/mismatched "Assigned To").
  // They are stored with assigned_to = "-", so they are invisible to every
  // employee until an admin/manager assigns them — the UI must say so.
  unassigned: number;
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
      data: { leads: [], skippedDuplicates, skippedRows, unassigned: 0 },
    };
  }

  // Imported rows without an agent: invisible to employees (their list is
  // scoped to assigned_to = their own name), so the caller warns about them.
  const unassigned = freshRecords.filter((record) => !record.assigned_to || record.assigned_to === "-").length;

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
    return { success: true, data: { leads: insertedLeads, skippedDuplicates, skippedRows, unassigned } };
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error, "Unable to import leads."),
    };
  }
}

// Best-effort timeline entry. Never throws: a failed activity log must not
// block the actual lead write. RLS decides who may insert (admins/managers for
// all leads, employees only for leads assigned to them as themselves).
async function recordLeadActivity(
  supabase: Awaited<ReturnType<typeof createClient>>,
  leadId: string,
  userId: string,
  actionType: string,
  description: string,
): Promise<void> {
  try {
    await supabase.from("lead_activities").insert({
      lead_id: leadId,
      user_id: userId,
      action_type: actionType,
      description,
    });
  } catch {
    // Swallow — the timeline is a nice-to-have, the lead update is the truth.
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
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Capture the previous status so the timeline can show the real transition.
    const { data: before } = await supabase
      .from("leads")
      .select("status")
      .eq("id", input.id)
      .single();

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

    const previousStatus = (before?.status ?? "").trim();
    if (user && previousStatus && previousStatus !== input.status) {
      await recordLeadActivity(supabase, input.id, user.id, "status", `${previousStatus} → ${input.status}`);
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
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const nextFollowUp = followUpDate.trim();
    const { data, error } = await supabase
      .from("leads")
      .update({ follow_up_date: nextFollowUp || "-" })
      .eq("id", leadId)
      .select()
      .single();

    if (error) return { success: false, error: error.message };
    if (user) {
      await recordLeadActivity(
        supabase,
        leadId,
        user.id,
        "follow_up",
        nextFollowUp ? `Follow-up set: ${nextFollowUp}` : "Follow-up clear kiya",
      );
    }
    revalidatePath("/dashboard");
    return { success: true, data: data as Lead };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Unable to update follow-up date.") };
  }
}

// Deleting every lead is the one action that can empty the product, so it
// (a) requires the literal confirmation phrase from `lib/lead-deletion`, and
// (b) snapshots the doomed rows into `lead_deletion_backups` FIRST — free-tier
// Supabase has no automatic backups, so without this a mis-click was permanent.
const BACKUP_LEAD_LIMIT = 5000;
const BACKUP_ACTIVITY_LIMIT = 20000;


/**
 * The chainable subset of a Postgrest builder used by the backup + delete.
 * The builder methods mutate the instance and return `this`, so the helpers
 * below keep the caller's concrete builder type (an unconstrained generic) and
 * cast internally — constraining the generic against the Supabase builder types
 * triggers TS2589 (excessively deep instantiation).
 */
interface MutableScopedBuilder {
  eq(column: string, value: string): unknown;
  or(expression: string): unknown;
  in(column: string, values: readonly string[]): unknown;
  not(column: string, operator: string, value: null): unknown;
}

interface DeleteScope {
  /** One employee's leads (admin drill-down). */
  assignedTo: string;
  /** Pre-built `and/or` search expression, if the search box was active. */
  searchFilter: string | null;
  /** Exact ticked ids — the only scope used by the "selected rows" delete. */
  ids?: readonly string[];
  /** Whole-table wipe: add an always-true filter so the delete is explicit. */
  unscoped: boolean;
}

function applyDeleteScope<Q>(query: Q, scope: DeleteScope): Q {
  const scoped = query as unknown as MutableScopedBuilder;
  if (scope.assignedTo) scoped.eq("assigned_to", scope.assignedTo);
  if (scope.searchFilter) scoped.or(scope.searchFilter);
  if (scope.ids?.length) scoped.in("id", scope.ids);
  else if (scope.unscoped) scoped.not("id", "is", null);
  return query;
}

/** Outcome of the pre-delete snapshot. `skipped` = undo is unavailable. */
type SnapshotOutcome = { ok: true; skipped: boolean } | { ok: false; error: string };

/**
 * Copies every lead (plus its cascading activities) that the upcoming delete
 * would remove into `lead_deletion_backups`.
 *
 * If the migration has not been applied yet the table simply does not exist:
 * that only costs the undo, so the delete still goes ahead and the caller warns
 * the user. Any OTHER failure (network, permissions, quota) blocks the delete,
 * because that is a real problem we must not hide.
 */
async function snapshotLeadsForDeletion(
  supabase: LeadsSupabaseClient,
  scope: DeleteScope,
  meta: { scopeLabel: string; search: string; deletedByName: string },
  userId: string,
): Promise<SnapshotOutcome> {
  const leadRows: Record<string, unknown>[] = [];
  for (let from = 0; from < BACKUP_LEAD_LIMIT; from += 500) {
    const { data, error } = await applyDeleteScope(supabase.from("leads").select("*"), scope)
      .order("created_at", { ascending: false })
      .range(from, from + 499);
    if (error) return { ok: false, error: `Backup failed before deleting: ${error.message}` };
    const chunk = (data ?? []) as Record<string, unknown>[];
    leadRows.push(...chunk);
    if (chunk.length < 500) break;
  }

  // Nothing matched → no snapshot needed (the delete is a no-op anyway).
  if (leadRows.length === 0) return { ok: true, skipped: false };

  const leadIds = leadRows.map((row) => String(row.id ?? "")).filter(Boolean);
  const activityRows: Record<string, unknown>[] = [];
  for (let index = 0; index < leadIds.length && activityRows.length < BACKUP_ACTIVITY_LIMIT; index += 200) {
    const { data, error } = await supabase
      .from("lead_activities")
      .select("*")
      .in("lead_id", leadIds.slice(index, index + 200));
    if (error) return { ok: false, error: `Backup failed before deleting: ${error.message}` };
    activityRows.push(...((data ?? []) as Record<string, unknown>[]));
  }

  const { error: backupError } = await supabase.from("lead_deletion_backups").insert({
    deleted_by: userId,
    deleted_by_name: meta.deletedByName,
    scope: meta.scopeLabel,
    search: meta.search,
    row_count: leadRows.length,
    activity_count: activityRows.length,
    lead_rows: leadRows,
    activity_rows: activityRows,
  });
  if (!backupError) return { ok: true, skipped: false };

  // Migration not applied yet → undo is off, but deleting must keep working.
  if (isMissingBackupTableError(backupError)) return { ok: true, skipped: true };

  return { ok: false, error: `Delete blocked — nothing was deleted. ${backupError.message}` };
}

export async function bulkDeleteLeads(
  leadIds: string[],
  deleteAll = false,
  search = "",
  assignedTo = "",
  confirmText = "",
): Promise<ActionResult<{ deleted: number; snapshotSkipped: boolean }>> {
  if (!deleteAll && leadIds.length === 0) return { success: false, error: "No leads selected." };

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "You must be signed in." };

    const { data: profile } = await supabase.from("profiles").select("role, name").eq("id", user.id).single();
    if (profile?.role !== "admin" && profile?.role !== "manager") {
      return { success: false, error: "Deleting leads is restricted to admins and managers (403 Forbidden)." };
    }
    const deletedByName = profile?.name?.trim() || "-";

    if (deleteAll) {
      // "Select All" delete: wipe leads with ONE query instead of shipping a
      // 1k+ element ID array that overflows serverless payload limits
      // (HTTP 400). lead_activities rows are removed automatically via the
      // ON DELETE CASCADE foreign key. Note: leads.id is a uuid, so the
      // always-true filter uses `.not("id", "is", null)` rather than `.neq("id", 0)`.
      // When a server-side search is active, only leads matching that search
      // are wiped, so "Select All" never deletes more than what is visible.
      const searchFilter = buildLeadSearchFilter(search);
      const scopedToEmployee = assignedTo.trim();
      const unscoped = !scopedToEmployee && !searchFilter;
      if (unscoped && confirmText.trim().toUpperCase() !== DELETE_ALL_CONFIRMATION) {
        return {
          success: false,
          error: `This deletes EVERY lead in the database. Type "${DELETE_ALL_CONFIRMATION}" to confirm.`,
        };
      }

      const scope: DeleteScope = { assignedTo: scopedToEmployee, searchFilter, unscoped };
      const snapshot = await snapshotLeadsForDeletion(
        supabase,
        scope,
        {
          scopeLabel: unscoped ? "all" : scopedToEmployee ? "employee" : "search",
          search,
          deletedByName,
        },
        user.id,
      );
      if (!snapshot.ok) return { success: false, error: snapshot.error };
      // FAIL CLOSED on the one unrecoverable operation: wiping EVERY lead when
      // no snapshot could be stored (the backup table migration is missing)
      // would leave the pipeline with no copy anywhere. Bounded deletes (one
      // employee, one search, ticked rows) still work, and they are always
      // accompanied by the browser's pre-delete CSV.
      if (unscoped && snapshot.skipped) {
        return {
          success: false,
          error: `Wiping EVERY lead is blocked: the deletion history table does not exist, so nothing could be saved for undo. ${LEAD_DELETION_BACKUP_SETUP_HINT}`,
        };
      }

      const countQuery = supabase.from("leads").select("id", { count: "exact", head: true });
      const { count: total, error: countError } = await applyDeleteScope(countQuery, scope);
      if (countError) return { success: false, error: countError.message };

      const { error } = await applyDeleteScope(supabase.from("leads").delete(), scope);
      if (error) return { success: false, error: error.message };

      revalidatePath("/dashboard");
      return { success: true, data: { deleted: total ?? 0, snapshotSkipped: snapshot.skipped } };
    }

    // Selected-rows delete still gets a snapshot (ids are chunked by the
    // helper), so even a small mistaken tick is restorable.
    const selectionSnapshot = await snapshotLeadsForDeletion(
      supabase,
      { assignedTo: "", searchFilter: "", unscoped: false, ids: leadIds },
      { scopeLabel: "selection", search: "", deletedByName },
      user.id,
    );
    if (!selectionSnapshot.ok) return { success: false, error: selectionSnapshot.error };

    const { data, error } = await supabase
      .from("leads")
      .delete()
      .in("id", leadIds)
      .select("id");
    if (error) return { success: false, error: error.message };

    revalidatePath("/dashboard");
    return { success: true, data: { deleted: data?.length ?? 0, snapshotSkipped: selectionSnapshot.skipped } };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Unable to delete leads.") };
  }
}

/** Admin/manager list of past bulk deletions, newest first (payloads excluded). */
export async function getLeadDeletionBackups(): Promise<ActionResult<LeadDeletionBackup[]>> {
  try {
    const supabase = await createClient();
    const viewerRole = await getViewerRole(supabase);
    if (viewerRole !== "admin" && viewerRole !== "manager") {
      return { success: false, error: "Only admins and managers can view deletion history (403 Forbidden)." };
    }

    const { data, error } = await supabase
      .from("lead_deletion_backups")
      .select("id, scope, search, deleted_by_name, row_count, activity_count, restored_at, created_at")
      .order("created_at", { ascending: false })
      .limit(25);
    if (error) {
      return {
        success: false,
        error: isMissingBackupTableError(error)
          ? `Deletion history is not set up yet. ${LEAD_DELETION_BACKUP_SETUP_HINT}`
          : error.message,
      };
    }
    return { success: true, data: (data ?? []) as LeadDeletionBackup[] };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Unable to load deletion history.") };
  }
}

/**
 * Re-inserts a snapshot. Ids are preserved and conflicts ignored, so restoring
 * twice — or restoring after some leads were re-imported — can never duplicate
 * a row.
 */
export async function restoreLeadDeletionBackup(
  backupId: string,
): Promise<ActionResult<{ restored: number }>> {
  if (!backupId) return { success: false, error: "No deletion selected." };

  try {
    const supabase = await createClient();
    const viewerRole = await getViewerRole(supabase);
    if (viewerRole !== "admin" && viewerRole !== "manager") {
      return { success: false, error: "Only admins and managers can restore leads (403 Forbidden)." };
    }

    const { data: backup, error: backupError } = await supabase
      .from("lead_deletion_backups")
      .select("id, lead_rows, activity_rows")
      .eq("id", backupId)
      .single();
    if (backupError || !backup) {
      return {
        success: false,
        error: isMissingBackupTableError(backupError)
          ? `Deletion history is not set up yet. ${LEAD_DELETION_BACKUP_SETUP_HINT}`
          : backupError?.message ?? "That deletion no longer exists.",
      };
    }

    const leadRows = Array.isArray(backup.lead_rows) ? (backup.lead_rows as Record<string, unknown>[]) : [];
    if (leadRows.length === 0) return { success: false, error: "That deletion has no stored rows." };

    let restored = 0;
    for (let index = 0; index < leadRows.length; index += 200) {
      const chunk = leadRows.slice(index, index + 200);
      const { data: inserted, error: insertError } = await supabase
        .from("leads")
        .upsert(chunk, { onConflict: "id", ignoreDuplicates: true })
        .select("id");
      if (insertError) return { success: false, error: insertError.message };
      restored += inserted?.length ?? 0;
    }

    const activityRows = Array.isArray(backup.activity_rows) ? (backup.activity_rows as Record<string, unknown>[]) : [];
    for (let index = 0; index < activityRows.length; index += 200) {
      await supabase
        .from("lead_activities")
        .upsert(activityRows.slice(index, index + 200), { onConflict: "id", ignoreDuplicates: true });
    }

    await supabase
      .from("lead_deletion_backups")
      .update({ restored_at: new Date().toISOString() })
      .eq("id", backupId);

    revalidatePath("/dashboard");
    return { success: true, data: { restored } };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Unable to restore leads.") };
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
  source?: string;
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
  // Source tracking: admins/managers can correct where a lead actually came
  // from (the DB trigger blocks employees from touching this core field).
  if (input.source !== undefined) updates.source = input.source.trim() || "Manual";

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


export interface PipelineInsights {
  total: number;
  open: number;
  won: number;
  lost: number;
  conversionRate: number;
  overdueFollowUps: number;
  dueToday: number;
  unassigned: number;
  bySource: Array<{ label: string; count: number }>;
  byStatus: Array<{ label: string; count: number }>;
  byTemperature: Array<{ label: string; count: number }>;
}

function parseStoredDateKey(value: string | null | undefined): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw || raw === "-") return "";
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  }
  const dmy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayDateKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export async function completeFollowUp(
  leadId: string,
  note = "",
): Promise<ActionResult<Lead>> {
  if (!leadId) return { success: false, error: "Lead ID is required." };

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) return { success: false, error: "You must be signed in." };

    const { data: updated, error: updateError } = await supabase
      .from("leads")
      .update({ follow_up_date: "-" })
      .eq("id", leadId)
      .select()
      .single();
    if (updateError) return { success: false, error: updateError.message };

    const description = [
      "Follow-up completed",
      note.trim() ? `Note: ${note.trim()}` : "",
    ].filter(Boolean).join(" — ");

    const { error: activityError } = await supabase
      .from("lead_activities")
      .insert({
        lead_id: leadId,
        user_id: user.id,
        action_type: "Follow-up completed",
        description,
      });
    if (activityError) return { success: false, error: activityError.message };

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/tasks");
    return { success: true, data: updated as Lead };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Unable to complete follow-up.") };
  }
}

export async function rescheduleFollowUp(
  leadId: string,
  followUpDate: string,
): Promise<ActionResult<Lead>> {
  if (!leadId || !followUpDate) {
    return { success: false, error: "Lead and follow-up date are required." };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) return { success: false, error: "You must be signed in." };

    const normalized = parseStoredDateKey(followUpDate);
    if (!normalized) return { success: false, error: "Please provide a valid follow-up date." };

    const { data, error } = await supabase
      .from("leads")
      .update({ follow_up_date: normalized })
      .eq("id", leadId)
      .select()
      .single();
    if (error) return { success: false, error: error.message };

    const { error: activityError } = await supabase
      .from("lead_activities")
      .insert({
        lead_id: leadId,
        user_id: user.id,
        action_type: "Follow-up rescheduled",
        description: `Next follow-up: ${normalized}`,
      });
    if (activityError) return { success: false, error: activityError.message };

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/tasks");
    return { success: true, data: data as Lead };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Unable to reschedule follow-up.") };
  }
}

export async function logLeadCall(
  input: { lead_id: string; outcome: string; notes?: string | null; next_follow_up_date?: string | null },
): Promise<ActionResult<LeadActivity>> {
  if (!input.lead_id || !input.outcome.trim()) {
    return { success: false, error: "Lead and call outcome are required." };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) return { success: false, error: "You must be signed in." };

    let nextDate = "";
    if (input.next_follow_up_date?.trim()) {
      nextDate = parseStoredDateKey(input.next_follow_up_date);
      if (!nextDate) return { success: false, error: "Invalid next follow-up date." };
    }

    const parts = [`Outcome: ${input.outcome.trim()}`];
    if (input.notes?.trim()) parts.push(`Notes: ${input.notes.trim()}`);
    if (nextDate) parts.push(`Next follow-up: ${nextDate}`);

    const { data, error } = await supabase
      .from("lead_activities")
      .insert({
        lead_id: input.lead_id,
        user_id: user.id,
        action_type: "Call",
        description: parts.join(" — "),
      })
      .select()
      .single();

    if (error) return { success: false, error: error.message };

    if (nextDate) {
      const { error: followUpError } = await supabase
        .from("leads")
        .update({ follow_up_date: nextDate })
        .eq("id", input.lead_id);
      if (followUpError) return { success: false, error: followUpError.message };
    }

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/tasks");
    return { success: true, data: data as LeadActivity };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Unable to log call.") };
  }
}

export async function getPipelineInsights(): Promise<ActionResult<PipelineInsights>> {
  const empty: PipelineInsights = {
    total: 0,
    open: 0,
    won: 0,
    lost: 0,
    conversionRate: 0,
    overdueFollowUps: 0,
    dueToday: 0,
    unassigned: 0,
    bySource: [],
    byStatus: [],
    byTemperature: [],
  };

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) return { success: true, data: empty };

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("name, role")
      .eq("id", user.id)
      .single();
    if (profileError || !profile) return { success: true, data: empty };

    const sourceMap = new Map<string, number>();
    const statusMap = new Map<string, number>();
    const temperatureMap = new Map<string, number>();
    let total = 0;
    let won = 0;
    let lost = 0;
    let unassigned = 0;
    let overdueFollowUps = 0;
    let dueToday = 0;
    const todayKey = todayDateKey();
    const chunkSize = 1000;
    const limit = 20000;

    for (let from = 0; from < limit; from += chunkSize) {
      let query = supabase
        .from("leads")
        .select("status, source, temperature, assigned_to, follow_up_date");
      if (profile.role === "employee") {
        query = query.ilike("assigned_to", profile.name ?? "");
      }

      const { data, error } = await query.range(from, from + chunkSize - 1);
      if (error) return { success: false, error: error.message };

      const rows = data ?? [];
      for (const row of rows) {
        total += 1;
        const status = String(row.status ?? "-");
        const source = String(row.source ?? "-");
        const temperature = String(row.temperature ?? "-");
        statusMap.set(status, (statusMap.get(status) ?? 0) + 1);
        sourceMap.set(source, (sourceMap.get(source) ?? 0) + 1);
        temperatureMap.set(temperature, (temperatureMap.get(temperature) ?? 0) + 1);

        if (status === "Won") won += 1;
        if (status === "Lost") lost += 1;
        if (!row.assigned_to || row.assigned_to === "-") unassigned += 1;

        const followUpKey = parseStoredDateKey(String(row.follow_up_date ?? ""));
        if (followUpKey && followUpKey < todayKey) overdueFollowUps += 1;
        if (followUpKey === todayKey) dueToday += 1;
      }

      if (rows.length < chunkSize) break;
    }

    const closed = won + lost;
    const conversionRate = closed > 0 ? Math.round((won / closed) * 100) : 0;
    const toSorted = (map: Map<string, number>, limitCount: number) =>
      Array.from(map.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, limitCount)
        .map(([label, count]) => ({ label, count }));

    return {
      success: true,
      data: {
        total,
        open: Math.max(0, total - won - lost),
        won,
        lost,
        conversionRate,
        overdueFollowUps,
        dueToday,
        unassigned,
        bySource: toSorted(sourceMap, 6),
        byStatus: toSorted(statusMap, 10),
        byTemperature: toSorted(temperatureMap, 3),
      },
    };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Unable to load pipeline insights.") };
  }
}
