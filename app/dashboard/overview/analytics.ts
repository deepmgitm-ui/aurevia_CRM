// ---------------------------------------------------------------------------
// Aurevia HealthCare — admin analytics helpers.
//
// This module is intentionally pure (no "use server" / "use client") so the
// exact same aggregation runs on the server for the first render and in the
// browser when the dashboard filters change.
// ---------------------------------------------------------------------------

import type { EmployeeDirectoryEntry, Lead } from "@/app/actions/leads";

export interface DateRange {
  /** ISO yyyy-mm-dd (inclusive). */
  from: string;
  /** ISO yyyy-mm-dd (inclusive). */
  to: string;
}

/**
 * Slim lead projection used for analytics (a light subset of public.leads).
 * `disease` is the raw disease text; `treatment` is the resolved treatment
 * string (treatment_type → treatment → disease) used for treatment grouping.
 */
export interface AnalyticsLead {
  id: string;
  name: string;
  city: string;
  disease: string;
  treatment: string;
  source: string;
  status: string;
  temperature: string;
  assigned_to: string;
  lead_date: string;
}

export type StageKey = "new" | "contacted" | "booked" | "attended" | "surgery" | "lost";

export const PIPELINE_STAGES: { key: StageKey; label: string }[] = [
  { key: "new", label: "New Lead" },
  { key: "contacted", label: "Contacted" },
  { key: "booked", label: "Consultation Booked" },
  { key: "attended", label: "Consultation Attended" },
  { key: "surgery", label: "Surgery Completed" },
];

export type TreatmentKey = "lasik" | "cataract" | "icl" | "other" | "unrecorded";

export const TREATMENT_COLORS: Record<TreatmentKey, string> = {
  lasik: "#1d4ed8",
  cataract: "#60a5fa",
  icl: "#a855f7",
  other: "#f472b6",
  // Deliberately grey: this segment means "the field is empty", not a treatment.
  unrecorded: "#94a3b8",
};

export const TREATMENT_LABELS: Record<TreatmentKey, string> = {
  lasik: "LASIK",
  cataract: "Cataract",
  icl: "ICL",
  other: "Other",
  unrecorded: "Not Recorded",
};

/** Series key for "no treatment captured" — always rendered last. */
export const UNRECORDED_TREATMENT_KEY = "unrecorded";

/** Keywords → canonical treatment name, used for both the disease field and
 *  free-text remarks ("age -25 , lasik , tuesday call back" → LASIK). */
const TREATMENT_PATTERNS: { pattern: RegExp; label: string }[] = [
  {
    pattern: /(lasik|lasic|lasek|lazik|lasix|laser|femto|contoura|wavefront|\bprk\b|refractiv|\bsmile\b)/,
    label: "LASIK",
  },
  {
    pattern: /(cataract|catract|catarct|cateract|motiyabind|motia|phaco|\biol\b|intra ?ocular|\blens\b|toric)/,
    label: "Cataract",
  },
  { pattern: /(\bicl\b|\bicle\b|implant|phakic|collamer)/, label: "ICL" },
  { pattern: /(retina|vitreous|macula|diabet)/, label: "Retina" },
  { pattern: /(keratoconus|cross ?link)/, label: "Keratoconus" },
  { pattern: /(squint|strabismus)/, label: "Squint" },
  { pattern: /(glaucoma)/, label: "Glaucoma" },
  { pattern: /(pterygium)/, label: "Pterygium" },
  { pattern: /(\bdcr\b|dacryo|watering eye)/, label: "DCR" },
  { pattern: /(ptosis|oculoplasty|chalazion|dermoid)/, label: "Oculoplasty" },
  { pattern: /(spectacle|glasses|specs|eye power|\bpower\b)/, label: "Spectacles" },
];

/**
 * Picks a treatment name out of any text (a `disease` value or a remarks note).
 * Returns "" when the text mentions no treatment at all, so callers can tell
 * "not recorded" apart from "recorded but unusual".
 */
export function detectTreatmentName(text: string): string {
  const value = (text ?? "").toLowerCase();
  if (!value) return "";
  for (const { pattern, label } of TREATMENT_PATTERNS) {
    if (pattern.test(value)) return label;
  }
  return "";
}

/** The five pipeline stages (Lost/Dropped is tracked but never part of the funnel). */
const PIPELINE_STAGE_KEYS = new Set<StageKey>(
  PIPELINE_STAGES.map((stage) => stage.key),
);

// Palette for dynamically discovered treatments. It deliberately EXCLUDES the
// four reference colours (LASIK / Cataract / ICL / Other) so a free-text series
// can never be painted the same blue as LASIK.
const TREATMENT_PALETTE = [
  "#10b981",
  "#f59e0b",
  "#06b6d4",
  "#8b5cf6",
  "#64748b",
  "#ef4444",
  "#14b8a6",
  "#f97316",
  // Four extra slots so a CRM that names 12+ different treatments still gets a
  // distinct colour per segment before anything folds into "Other".
  "#84cc16",
  "#d946ef",
  "#6366f1",
  "#e11d48",
];

// Known families always sort first so LASIK / Cataract / ICL stay readable.
const PREFERRED_TREATMENT_KEYS = ["lasik", "cataract", "icl"];
// Every disease/treatment WRITTEN in the leads table gets its own named, coloured
// segment — "Other" may only appear once a CRM names more distinct treatments
// than the legend can comfortably show (the smallest tail folds, biggest stay).
const MAX_TREATMENT_SERIES = 12;

const KNOWN_TREATMENT_KEYS = new Set<string>(Object.keys(TREATMENT_COLORS));

// Placeholders that mean "no treatment captured" — they must never become their
// own series (otherwise the chart grows a "N/A" legend entry).
const GENERIC_TREATMENT_VALUES = new Set([
  "other",
  "na",
  "n/a",
  "none",
  "nil",
  "null",
  "unknown",
  "not applicable",
  "-",
  "--",
  ".",
]);

/**
 * Slug used as the Recharts `dataKey` for a treatment series. Free-text
 * treatments may contain spaces, dots or slashes ("Retina / Vitreous 2.5") and
 * Recharts reads dots as nested object paths — so every key is normalised to
 * lowercase alphanumerics separated by dashes.
 */
export function slugifyTreatment(value: string): string {
  const slug = (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "other";
}

/**
 * Resolves one raw treatment string into a stable, case-insensitive group:
 * "LASIK", "lasik", " Lasik " and "LASIK Eye Surgery" all collapse onto the
 * same `lasik` key with the canonical "LASIK" label and colour, while free-text
 * treatments (e.g. "Retina Detachment") keep their own slugified series.
 */
export function canonicalTreatment(raw: string): { key: string; label: string } {
  const trimmed = (raw ?? "").trim();
  const lower = trimmed.toLowerCase();
  if (!lower || GENERIC_TREATMENT_VALUES.has(lower)) {
    // Empty / placeholder: label it honestly instead of pretending it is a
    // treatment category called "Other".
    return { key: UNRECORDED_TREATMENT_KEY, label: TREATMENT_LABELS.unrecorded };
  }
  // Known service lines, typos included ("LASIK", "catract", "toric lens",
  // "diabetic retina", "glasses").
  const detected = detectTreatmentName(trimmed);
  if (detected) return { key: slugifyTreatment(detected), label: detected };
  // Free text that names no known treatment ("Eye Checkup"): keep the typed
  // label but slugify the key so it stays safe as a Recharts dataKey.
  return { key: slugifyTreatment(lower), label: trimmed };
}

/**
 * Colour for ANY treatment key — the reference colours for the known families
 * (LASIK / Cataract / ICL / Other / Not Recorded), then a stable rotation through
 * the fallback palette. Hashing the key (instead of array position) keeps the
 * colour identical between the table rows, the summary chips and the charts.
 */
export function treatmentColor(key: string): string {
  const known = TREATMENT_COLORS[key as TreatmentKey];
  if (known) return known;
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) % 1_000_003;
  }
  return TREATMENT_PALETTE[hash % TREATMENT_PALETTE.length];
}

export interface TrendPoint {
  /** Month key "yyyy-mm" (used for month-over-month math). */
  key: string;
  /** Axis label, e.g. "Jul 2026". */
  month: string;
  leads: number;
  consultations: number;
  surgeries: number;
  lost: number;
}

export interface TreatmentSeries {
  key: string;
  label: string;
  color: string;
}

/** One treatment's count inside a pipeline stage (series cells carry values). */
export interface PipelineCell extends TreatmentSeries {
  value: number;
}

export interface PipelineRow {
  key: string;
  stage: string;
  series: PipelineCell[];
  total: number;
}

export interface BreakdownRow {
  label: string;
  leads: number;
  consultations: number;
  surgeries: number;
  conversion: number;
}

export interface AgentStat {
  id: string;
  name: string;
  role: string;
  leads: number;
  newLeads: number;
  hot: number;
  warm: number;
  cold: number;
  consultations: number;
  surgeries: number;
  lost: number;
  conversion: number;
}

export type KpiKey =
  | "totalLeads"
  | "consultationsBooked"
  | "surgeriesCompleted"
  | "lostLeads"
  | "conversionRate"
  | "activeAgents";

export interface KpiCard {
  key: KpiKey;
  label: string;
  value: string;
  delta: string;
}

export interface DashboardMetrics {
  /** True when the database has no leads yet and the design-reference dataset is shown. */
  isSample: boolean;
  range: DateRange;
  kpis: KpiCard[];
  trend: TrendPoint[];
  pipeline: PipelineRow[];
  /** Distinct treatments discovered in the data (case-insensitive), ordered for the chart. */
  treatmentSeries: TreatmentSeries[];
  cities: BreakdownRow[];
  sources: BreakdownRow[];
  agents: AgentStat[];
  /**
   * How many funnel leads actually carry a treatment name. When `recorded` is
   * far below `total`, the chart's grey "Not Recorded" segment dominates and the
   * UI nudges the admin to fill the Treatment / Disease field.
   */
  treatmentCoverage: { recorded: number; total: number };
  totals: {
    leads: number;
    consultations: number;
    surgeries: number;
    lost: number;
    agents: number;
  };
}

// ---------------------------------------------------------------------------
// Date + number helpers
// ---------------------------------------------------------------------------

/** Parses the CRM's text lead dates ("dd/mm/yyyy", "yyyy-mm-dd", "d-m-yy", ...). */
export function parseLeadDateText(value: string): Date | null {
  const text = (value ?? "").trim();
  if (!text || text === "-") return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const dayFirst = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(text);
  if (dayFirst) {
    const year = dayFirst[3].length === 2 ? Number(`20${dayFirst[3]}`) : Number(dayFirst[3]);
    return new Date(year, Number(dayFirst[2]) - 1, Number(dayFirst[1]));
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function toIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function parseIsoDate(value: string | undefined | null): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value ?? "").trim());
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthLabel(date: Date): string {
  return `${MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()}`;
}

export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** Quarter containing `today` — the dashboard default range (01 Jul - 30 Sep 2026 today). */
export function currentQuarterRange(today = new Date()): DateRange {
  const startMonth = Math.floor(today.getMonth() / 3) * 3;
  return {
    from: toIsoDate(new Date(today.getFullYear(), startMonth, 1)),
    to: toIsoDate(new Date(today.getFullYear(), startMonth + 3, 0)),
  };
}

/** "01 Jul 2026 - 30 Sep 2026" — the label used by the header range button. */
export function formatRangeLabel(range: DateRange): string {
  const format = (date: Date | null) =>
    date ? `${String(date.getDate()).padStart(2, "0")} ${MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()}` : "—";
  return `${format(parseIsoDate(range.from))} - ${format(parseIsoDate(range.to))}`;
}

export function formatNumber(value: number): string {
  return Math.round(value).toLocaleString("en-IN");
}


export function formatRate(value: number): string {
  return `${value.toFixed(1)}%`;
}

/** Signed month-over-month change, e.g. "+28.4%". */
export function percentDelta(current: number, previous: number): string {
  if (!previous) return current > 0 ? "+100.0%" : "+0.0%";
  const change = ((current - previous) / previous) * 100;
  return `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Lead → stage / treatment mapping
// ---------------------------------------------------------------------------

// Maps any free-text status the CRM stores ("New", "Contacted", "OPD Booked",
// "OPD Done", "IPD Done", "Won", "Lost", "Dropped", custom text, ...) onto the
// five reporting stages plus the Lost/Dropped bucket.
export function stageForStatus(status: string): StageKey {
  const value = (status ?? "").trim().toLowerCase();
  if (!value) return "new";

  // 1. Explicit negatives / dead ends, checked FIRST so "Non Surgical" can never
  //    be read as "Surgery Completed" by the /surg/ rule further down.
  if (
    /(lost|dropped|drop|cancel|no ?show|junk|dead|invalid|not interested|non[ -]?surg|budget issue|location issue|not reachable|refus)/.test(
      value,
    )
  ) {
    return "lost";
  }

  // 2. Scheduled but not completed: "IPD Booked" / "Surgery Scheduled".
  if (/(ipd|surg|operat)/.test(value) && /(book|schedul|plan)/.test(value)) return "booked";

  // 3. Completed surgery / won.
  if (/(surg|operat|\bipd\b|won|closed|success)/.test(value)) return "surgery";

  // 4. Booked consultation.
  if (/(book|schedul|propos|appoint)/.test(value)) return "booked";

  // 5. Consultation attended / visited.
  if (/(attend|visit|negotiat|\bdone\b|consult)/.test(value)) return "attended";

  // 6. Contact attempted. A "DNP" (did not pick up) status only exists because
  //    somebody rang the lead, so it is contacted — not a brand-new lead.
  if (
    /(contact|call|follow|reach|touch|ring|pursu|\bdnp\b|\brnr\b|no response|didn'?t pick|not pick)/.test(value)
  ) {
    return "contacted";
  }

  return "new";
}

// Case-insensitive keyword mapping onto the treatment families. Reads the
// resolved treatment string (treatment_type → treatment → treatment_name →
// surgery_type → surgery → procedure → disease) so whichever column the CRM
// stores wins automatically.
//
// Matching is substring-first ("LASIK Eye Surgery", "Cataract (LE)",
// "IOL Implant", "lasik-both eyes"), then tolerant of the typos a free-text CRM
// always collects ("Lasic", "Catract", "Phaco") so those rows still colour
// themselves instead of piling into "Other".
const TREATMENT_FAMILIES: { key: TreatmentKey; pattern: RegExp }[] = [
  {
    key: "lasik",
    pattern: /(lasik|lasic|lasek|lazik|lasix|laser|femto|contoura|wavefront|\bprk\b|refractiv|\bsmile\b)/,
  },
  {
    key: "cataract",
    pattern: /(cataract|catract|catarct|cateract|motiyabind|motia|phaco|\biol\b|intra ?ocular|\blens\b)/,
  },
  {
    key: "icl",
    pattern: /(\bicl\b|\bicle\b|implant|phakic|collamer)/,
  },
];

export function treatmentBucket(treatment: string): TreatmentKey {
  const value = (treatment ?? "").toLowerCase();
  for (const { key, pattern } of TREATMENT_FAMILIES) {
    if (pattern.test(value)) return key;
  }
  return "other";
}

// Every treatment column the CRM has been seen to store the value in, in
// priority order. `disease` is last because the leads table doubles it as the
// legacy "Treatment / Disease" field.
const TREATMENT_SOURCE_COLUMNS = [
  "treatment_type",
  "treatment",
  "treatment_name",
  "surgery_type",
  "surgery",
  "procedure",
  "disease",
] as const;

/**
 * Picks the treatment text out of a lead row. Blank values AND "-" placeholders
 * are skipped, so a populated `disease` still wins when `treatment_type` exists
 * as a column but is empty for that row (the exact case that used to make the
 * whole pipeline chart render as one "Other" bar).
 */
export function resolveTreatmentText(record: Record<string, unknown>): string {
  for (const column of TREATMENT_SOURCE_COLUMNS) {
    const value = textValue(record[column]);
    if (value && value !== "-") return value;
  }
  // Last resort: the treatment is frequently written inside the free-text
  // remarks ("age -25 , lasik , tuesday call back") because PDF / Excel / Magic
  // Paste imports often carry no dedicated treatment column at all. Only a
  // recognised treatment name is returned, so call noise ("invalid number",
  // "DNP") never becomes a series.
  return detectTreatmentName(textValue(record.remarks));
}

export function toAnalyticsLead(lead: Lead): AnalyticsLead {
  const record = lead as unknown as Record<string, unknown>;
  // Treatment is resolved from every candidate column (treatment_type →
  // treatment → treatment_name → surgery_type → surgery → procedure → disease).
  const resolvedTreatment = resolveTreatmentText(record);
  // Fall back to `created_at` when the lead has no editable lead date, so every
  // lead still lands in a month bucket on the trend chart.
  const rawLeadDate = textValue(lead.lead_date);
  const createdAt = textValue(lead.created_at);
  return {
    id: lead.id,
    name: lead.name ?? "",
    city: lead.city ?? "-",
    disease: lead.disease ?? "-",
    treatment: resolvedTreatment || "-",
    source: lead.source ?? "Manual",
    status: lead.status ?? "New",
    temperature: lead.temperature ?? "Warm",
    assigned_to: lead.assigned_to ?? "-",
    lead_date: rawLeadDate && rawLeadDate !== "-" ? rawLeadDate : createdAt || "-",
  };
}

// Safe text accessor for columns that may or may not exist on a lead row
// (treatment_type vs treatment vs disease fallbacks, custom selects, junk).
function textValue(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

/** A lead counts as "consultation booked" once it reaches the booked stage or beyond. */
export function reachedConsultation(stage: StageKey): boolean {
  return stage === "booked" || stage === "attended" || stage === "surgery";
}

function isWithinRange(date: Date | null, range: DateRange): boolean {
  // Undated leads are kept so nothing silently disappears from the totals.
  if (!date) return true;
  const from = parseIsoDate(range.from);
  const to = parseIsoDate(range.to);
  if (from && date < from) return false;
  if (to) {
    const end = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59);
    if (date > end) return false;
  }
  return true;
}

export function filterLeadsByRange(rows: AnalyticsLead[], range: DateRange): AnalyticsLead[] {
  return rows.filter((row) => isWithinRange(parseLeadDateText(row.lead_date), range));
}

function groupByMonth(rows: AnalyticsLead[], range: DateRange): TrendPoint[] {
  const buckets = new Map<string, TrendPoint>();
  const from = parseIsoDate(range.from);
  const to = parseIsoDate(range.to);

  // Pre-seed every month of the selected range so the axis always shows the
  // full window (Jul 2026 / Aug 2026 / Sep 2026 for the default quarter).
  if (from && to) {
    const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
    let guard = 0;
    while (cursor <= to && guard < 24) {
      buckets.set(monthKey(cursor), {
        key: monthKey(cursor),
        month: monthLabel(cursor),
        leads: 0,
        consultations: 0,
        surgeries: 0,
        lost: 0,
      });
      cursor.setMonth(cursor.getMonth() + 1);
      guard += 1;
    }
  }

  for (const row of rows) {
    const date = parseLeadDateText(row.lead_date);
    if (!date) continue;
    const key = monthKey(date);
    let point = buckets.get(key);
    if (!point) {
      point = { key, month: monthLabel(date), leads: 0, consultations: 0, surgeries: 0, lost: 0 };
      buckets.set(key, point);
    }
    const stage = stageForStatus(row.status);
    point.leads += 1;
    if (reachedConsultation(stage)) point.consultations += 1;
    if (stage === "surgery") point.surgeries += 1;
    if (stage === "lost") point.lost += 1;
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, point]) => point);
}

interface StageBucket {
  leads: number;
  consultations: number;
  surgeries: number;
  lost: number;
}

function emptyBucket(): StageBucket {
  return { leads: 0, consultations: 0, surgeries: 0, lost: 0 };
}

function accumulate(bucket: StageBucket, stage: StageKey): void {
  bucket.leads += 1;
  if (reachedConsultation(stage)) bucket.consultations += 1;
  if (stage === "surgery") bucket.surgeries += 1;
  if (stage === "lost") bucket.lost += 1;
}

function toBreakdownRow(label: string, bucket: StageBucket): BreakdownRow {
  const surgeries = bucket.surgeries;
  return {
    label,
    leads: bucket.leads,
    consultations: bucket.consultations,
    surgeries,
    conversion: bucket.leads === 0 ? 0 : (surgeries / bucket.leads) * 100,
  };
}

/** Top-N labels by a metric, used by the City / Source / Agent tables. */
function topRows(rows: BreakdownRow[], limit: number, primary: "surgeries" | "leads"): BreakdownRow[] {
  return [...rows]
    .sort((a, b) => (b[primary] - a[primary]) || (b.leads - a.leads) || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function emptyAgentStat(id: string, name: string, role: string): AgentStat {
  return {
    id,
    name,
    role,
    leads: 0,
    newLeads: 0,
    hot: 0,
    warm: 0,
    cold: 0,
    consultations: 0,
    surgeries: 0,
    lost: 0,
    conversion: 0,
  };
}

function parseMonthKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, 1) : null;
}

/** Distinct agents who received at least one lead in the given month. */
function activeAgentsInMonth(rows: AnalyticsLead[], month: Date | null): number {
  if (!month) return 0;
  const key = monthKey(month);
  const names = new Set<string>();
  for (const row of rows) {
    const date = parseLeadDateText(row.lead_date);
    if (!date || monthKey(date) !== key) continue;
    const assigned = (row.assigned_to || "").trim();
    if (assigned && assigned !== "-") names.add(assigned.toLowerCase());
  }
  return names.size;
}

// ---------------------------------------------------------------------------
// Main aggregation
// ---------------------------------------------------------------------------

export function buildDashboardMetrics(
  allRows: AnalyticsLead[],
  employees: EmployeeDirectoryEntry[] = [],
  range: DateRange,
): DashboardMetrics {
  const rows = filterLeadsByRange(allRows, range);
  const trend = groupByMonth(rows, range);

  // Counts keyed by (stage, treatment) — built in the single pass below, then
  // shaped into the dynamic pipeline once the distinct treatments are known.
  const countsByStage = new Map<string, Map<string, number>>();
  const treatmentTotals = new Map<string, number>();
  const treatmentLabels = new Map<string, string>();

  const cityBuckets = new Map<string, StageBucket>();
  const sourceBuckets = new Map<string, StageBucket>();
  const stageTotals: Record<StageKey, number> = { new: 0, contacted: 0, booked: 0, attended: 0, surgery: 0, lost: 0 };

  // Agents start from the employee directory so people with zero leads still
  // appear in the roster instead of vanishing from the dashboard.
  const agents = new Map<string, AgentStat>();
  for (const employee of employees) {
    const name = employee.name.trim();
    if (!name) continue;
    agents.set(name.toLowerCase(), emptyAgentStat(employee.id, name, employee.role));
  }

  // How much of the funnel actually carries a treatment name (drives the
  // "Not Recorded" hint under the pipeline chart).
  let funnelTotal = 0;
  let funnelRecorded = 0;

  for (const row of rows) {
    const stage = stageForStatus(row.status);
    stageTotals[stage] += 1;

    // Pipeline: group by BOTH status and treatment (case-insensitive).
    if (PIPELINE_STAGE_KEYS.has(stage)) {
      const treatment = canonicalTreatment(row.treatment || row.disease);
      const stageMap = countsByStage.get(stage) ?? new Map<string, number>();
      countsByStage.set(stage, stageMap);
      stageMap.set(treatment.key, (stageMap.get(treatment.key) ?? 0) + 1);
      treatmentTotals.set(treatment.key, (treatmentTotals.get(treatment.key) ?? 0) + 1);
      if (!treatmentLabels.has(treatment.key)) treatmentLabels.set(treatment.key, treatment.label);
      funnelTotal += 1;
      if (treatment.key !== UNRECORDED_TREATMENT_KEY) funnelRecorded += 1;
    }

    const city = (row.city || "-").trim() || "-";
    const cityBucket = cityBuckets.get(city) ?? emptyBucket();
    cityBuckets.set(city, cityBucket);
    accumulate(cityBucket, stage);

    const source = (row.source || "Manual").trim() || "Manual";
    const sourceBucket = sourceBuckets.get(source) ?? emptyBucket();
    sourceBuckets.set(source, sourceBucket);
    accumulate(sourceBucket, stage);

    const assigned = (row.assigned_to || "").trim();
    if (assigned && assigned !== "-") {
      const agentKey = assigned.toLowerCase();
      const stat = agents.get(agentKey) ?? emptyAgentStat(`lead-${agentKey}`, assigned, "employee");
      agents.set(agentKey, stat);
      stat.leads += 1;
      if (stage === "new") stat.newLeads += 1;
      if (reachedConsultation(stage)) stat.consultations += 1;
      if (stage === "surgery") stat.surgeries += 1;
      if (stage === "lost") stat.lost += 1;
      const temperature = (row.temperature || "").trim().toLowerCase();
      if (temperature.startsWith("hot")) stat.hot += 1;
      else if (temperature.startsWith("cold")) stat.cold += 1;
      else stat.warm += 1;
    }
  }

  for (const stat of agents.values()) {
    stat.conversion = stat.leads === 0 ? 0 : (stat.surgeries / stat.leads) * 100;
  }

  // --- Dynamic treatment series: known families first, then biggest buckets ---
  // "Not Recorded" is excluded from the volume sort and appended last in grey,
  // so a row of empty treatment fields can never bury the real treatments.
  const recordedKeys = [...treatmentTotals.keys()]
    .filter((key) => key !== UNRECORDED_TREATMENT_KEY)
    .sort((a, b) => {
      const rankA = PREFERRED_TREATMENT_KEYS.indexOf(a);
      const rankB = PREFERRED_TREATMENT_KEYS.indexOf(b);
      if (rankA !== rankB) {
        return (
          (rankA < 0 ? PREFERRED_TREATMENT_KEYS.length : rankA) -
          (rankB < 0 ? PREFERRED_TREATMENT_KEYS.length : rankB)
        );
      }
      if (rankA >= 0) return 0;
      return (treatmentTotals.get(b) ?? 0) - (treatmentTotals.get(a) ?? 0);
    });

  const visibleRecorded = recordedKeys.slice(0, MAX_TREATMENT_SERIES);
  if (recordedKeys.length > MAX_TREATMENT_SERIES) {
    // Keep the legend bounded: drop the smallest series and fold it into "Other".
    visibleRecorded.pop();
    if (!visibleRecorded.includes("other")) visibleRecorded.push("other");
  }
  const visibleKeys = treatmentTotals.has(UNRECORDED_TREATMENT_KEY)
    ? [...visibleRecorded, UNRECORDED_TREATMENT_KEY]
    : visibleRecorded;

  // Reference colours (LASIK dark blue, Cataract light blue, ICL purple, Other
  // pink, Not Recorded grey); free-text treatments rotate the palette.
  let fallbackIndex = 0;
  const treatmentSeries: TreatmentSeries[] = visibleKeys
    .filter((key) => key !== "other" && key !== UNRECORDED_TREATMENT_KEY)
    .concat(visibleKeys.includes("other") ? ["other"] : [])
    .concat(visibleKeys.includes(UNRECORDED_TREATMENT_KEY) ? [UNRECORDED_TREATMENT_KEY] : [])
    .map((key) => {
      const label = KNOWN_TREATMENT_KEYS.has(key)
        ? TREATMENT_LABELS[key as TreatmentKey]
        : (treatmentLabels.get(key) ?? key);
      const color = KNOWN_TREATMENT_KEYS.has(key)
        ? TREATMENT_COLORS[key as TreatmentKey]
        : TREATMENT_PALETTE[fallbackIndex++ % TREATMENT_PALETTE.length];
      return { key, label, color };
    });

  const pipeline: PipelineRow[] = PIPELINE_STAGES.map(({ key, label }) => {
    const stageMap = countsByStage.get(key);
    const values = new Map<string, number>(treatmentSeries.map((entry) => [entry.key, 0]));
    if (stageMap) {
      for (const [treatmentKey, count] of stageMap) {
        // Treatments outside the cap are folded into the "Other" cell.
        const target = visibleKeys.includes(treatmentKey) ? treatmentKey : "other";
        values.set(target, (values.get(target) ?? 0) + count);
      }
    }
    const series: PipelineCell[] = treatmentSeries.map((entry) => ({
      ...entry,
      value: values.get(entry.key) ?? 0,
    }));
    return {
      key,
      stage: label,
      series,
      total: series.reduce((sum, cell) => sum + cell.value, 0),
    };
  });

  const totalLeads = rows.length;
  const consultations = stageTotals.booked + stageTotals.attended + stageTotals.surgery;
  const surgeries = stageTotals.surgery;
  const lostLeads = stageTotals.lost;
  const conversionRate = totalLeads === 0 ? 0 : (surgeries / totalLeads) * 100;
  const agentStats = [...agents.values()].sort(
    (a, b) => b.surgeries - a.surgeries || b.leads - a.leads || a.name.localeCompare(b.name),
  );
  const activeAgents = agentStats.filter((stat) => stat.leads > 0).length;

  // Month-over-month trend indicators printed on the KPI cards.
  const currentPoint = trend.at(-1);
  const previousPoint = trend.at(-2);
  const previousMonth = previousPoint ? parseMonthKey(previousPoint.key) : null;
  const currentMonth = currentPoint ? parseMonthKey(currentPoint.key) : null;
  const rateOf = (point: TrendPoint | undefined) =>
    !point || point.leads === 0 ? 0 : (point.surgeries / point.leads) * 100;

  const kpis: KpiCard[] = [
    {
      key: "totalLeads",
      label: "Total Leads",
      value: formatNumber(totalLeads),
      delta: percentDelta(currentPoint?.leads ?? 0, previousPoint?.leads ?? 0),
    },
    {
      key: "consultationsBooked",
      label: "Consultations Booked",
      value: formatNumber(consultations),
      delta: percentDelta(currentPoint?.consultations ?? 0, previousPoint?.consultations ?? 0),
    },
    {
      key: "surgeriesCompleted",
      label: "Surgeries Completed",
      value: formatNumber(surgeries),
      delta: percentDelta(currentPoint?.surgeries ?? 0, previousPoint?.surgeries ?? 0),
    },
    {
      key: "lostLeads",
      label: "Lost/Dropped Leads",
      value: formatNumber(lostLeads),
      delta: percentDelta(currentPoint?.lost ?? 0, previousPoint?.lost ?? 0),
    },
    {
      key: "conversionRate",
      label: "Conversion Rate",
      value: formatRate(conversionRate),
      delta: percentDelta(rateOf(currentPoint), rateOf(previousPoint)),
    },
    {
      key: "activeAgents",
      label: "Active Agents",
      value: formatNumber(activeAgents),
      delta: percentDelta(activeAgentsInMonth(rows, currentMonth), activeAgentsInMonth(rows, previousMonth)),
    },
  ];

  const cityRows = [...cityBuckets.entries()]
    .filter(([label]) => label !== "-")
    .map(([label, bucket]) => toBreakdownRow(label, bucket));
  const sourceRows = [...sourceBuckets.entries()]
    .filter(([label]) => label !== "-")
    .map(([label, bucket]) => toBreakdownRow(label, bucket));

  return {
    isSample: false,
    range,
    kpis,
    trend,
    pipeline,
    treatmentSeries,
    treatmentCoverage: { recorded: funnelRecorded, total: funnelTotal },
    cities: topRows(cityRows, 8, "surgeries"),
    sources: topRows(sourceRows, 8, "leads"),
    agents: agentStats,
    totals: { leads: totalLeads, consultations, surgeries, lost: lostLeads, agents: activeAgents },
  };
}

// ---------------------------------------------------------------------------
// Design-reference dataset
//
// Used only when the leads table is still empty (fresh install / demo) so the
// dashboard renders the full designed layout instead of a wall of zeros. The
// UI marks these numbers as preview data.
// ---------------------------------------------------------------------------

function sampleBreakdown(
  label: string,
  leads: number,
  consultations: number,
  surgeries: number,
): BreakdownRow {
  return {
    label,
    leads,
    consultations,
    surgeries,
    conversion: leads === 0 ? 0 : (surgeries / leads) * 100,
  };
}

const SAMPLE_TREATMENT_SERIES: TreatmentSeries[] = [
  { key: "lasik", label: "LASIK", color: "#1d4ed8" },
  { key: "cataract", label: "Cataract", color: "#60a5fa" },
  { key: "icl", label: "ICL", color: "#a855f7" },
  { key: "other", label: "Other", color: "#f472b6" },
];

function samplePipelineRow(key: string, stage: string, values: number[]): PipelineRow {
  const series: PipelineCell[] = SAMPLE_TREATMENT_SERIES.map((entry, index) => ({
    ...entry,
    value: values[index] ?? 0,
  }));
  return { key, stage, series, total: series.reduce((sum, cell) => sum + cell.value, 0) };
}

export function createSampleMetrics(range: DateRange): DashboardMetrics {
  return {
    isSample: true,
    range,
    kpis: [
      { key: "totalLeads", label: "Total Leads", value: "1,248", delta: "+28.4%" },
      { key: "consultationsBooked", label: "Consultations Booked", value: "842", delta: "+22.1%" },
      { key: "surgeriesCompleted", label: "Surgeries Completed", value: "312", delta: "+18.7%" },
      { key: "lostLeads", label: "Lost/Dropped Leads", value: "112", delta: "+4.8%" },
      { key: "conversionRate", label: "Conversion Rate", value: "25.0%", delta: "+6.2%" },
      { key: "activeAgents", label: "Active Agents", value: "48", delta: "+20.0%" },
    ],
    trend: [
      { key: `${range.from.slice(0, 7)}`, month: "Jul 2026", leads: 180, consultations: 120, surgeries: 45, lost: 32 },
      { key: "2026-08", month: "Aug 2026", leads: 210, consultations: 150, surgeries: 72, lost: 38 },
      { key: "2026-09", month: "Sep 2026", leads: 248, consultations: 182, surgeries: 95, lost: 42 },
    ],
    treatmentSeries: SAMPLE_TREATMENT_SERIES,
    // The design-reference dataset has every treatment filled in.
    treatmentCoverage: { recorded: 1960, total: 1960 },
    pipeline: [
      samplePipelineRow("new", "New Lead", [320, 180, 90, 50]),
      samplePipelineRow("contacted", "Contacted", [240, 140, 70, 40]),
      samplePipelineRow("booked", "Consultation Booked", [180, 110, 50, 30]),
      samplePipelineRow("attended", "Consultation Attended", [120, 80, 40, 20]),
      samplePipelineRow("surgery", "Surgery Completed", [90, 70, 30, 10]),
    ],
    cities: [
      sampleBreakdown("Delhi NCR", 268, 190, 98),
      sampleBreakdown("Gurgaon", 210, 150, 72),
      sampleBreakdown("Noida", 172, 120, 54),
      sampleBreakdown("Ghaziabad", 160, 108, 48),
      sampleBreakdown("Mumbai", 120, 82, 26),
      sampleBreakdown("Pune", 96, 66, 20),
      sampleBreakdown("Hyderabad", 84, 58, 18),
      sampleBreakdown("Gujarat", 72, 46, 16),
    ],
    sources: [
      sampleBreakdown("Online Enquiry", 420, 286, 104),
      sampleBreakdown("Agent Referral", 280, 190, 72),
      sampleBreakdown("Doctor Referral", 180, 124, 48),
      sampleBreakdown("Walk-in", 150, 104, 40),
      sampleBreakdown("Corporate Tie-up", 120, 82, 30),
      sampleBreakdown("Social Media", 98, 56, 18),
    ],
    agents: [
      sampleAgent("a1", "Ravi Sharma", 268, 48, 62, 141, 65, 178, 78, 12),
      sampleAgent("a2", "Priya Nair", 232, 42, 54, 122, 56, 158, 64, 16),
      sampleAgent("a3", "Amit Verma", 210, 38, 48, 110, 52, 142, 58, 18),
      sampleAgent("a4", "Sneha Kapoor", 196, 34, 44, 104, 48, 132, 46, 20),
      sampleAgent("a5", "Vikram Singh", 182, 30, 40, 96, 46, 122, 38, 22),
      sampleAgent("a6", "Neha Gupta", 160, 26, 34, 84, 42, 110, 28, 24),
    ],
    totals: { leads: 1248, consultations: 842, surgeries: 312, lost: 112, agents: 48 },
  };
}

function sampleAgent(
  id: string,
  name: string,
  leads: number,
  newLeads: number,
  hot: number,
  warm: number,
  cold: number,
  consultations: number,
  surgeries: number,
  lost: number,
): AgentStat {
  return {
    id,
    name,
    role: "employee",
    leads,
    newLeads,
    hot,
    warm,
    cold,
    consultations,
    surgeries,
    lost,
    conversion: leads === 0 ? 0 : (surgeries / leads) * 100,
  };
}

/**
 * Real numbers when the CRM has leads, the design-reference dataset otherwise.
 * When employees exist but no leads do, their real (zeroed) roster is kept so
 * the dashboard never attributes demo statistics to a real person.
 */
export function resolveDashboardMetrics(
  rows: AnalyticsLead[],
  range: DateRange,
  employees: EmployeeDirectoryEntry[] = [],
): DashboardMetrics {
  if (rows.length > 0) return buildDashboardMetrics(rows, employees, range);
  const sample = createSampleMetrics(range);
  if (employees.length === 0) return sample;
  return { ...sample, agents: buildDashboardMetrics([], employees, range).agents };
}

// ---------------------------------------------------------------------------
// Agent roster (photo/emoji + name only) and secure detail cards
// ---------------------------------------------------------------------------

const AGENT_EMOJIS = ["👩‍⚕️", "🧑‍⚕️", "👨‍⚕️", "👩‍💼", "🧑‍💼", "👨‍💼", "🙋‍♀️", "🙋‍♂️"];

/** Snapshot cards expose nothing but a face and a name until the admin opens the secure panel. */
export function buildAgentCards(employees: EmployeeDirectoryEntry[], agents: AgentStat[]): AgentCard[] {
  const statsByName = new Map(agents.map((stat) => [stat.name.trim().toLowerCase(), stat]));
  return employees
    .filter((employee) => employee.name.trim().length > 0)
    .map((employee, index) => {
      const name = employee.name.trim();
      return {
        id: employee.id,
        name,
        role: employee.role,
        emoji: AGENT_EMOJIS[index % AGENT_EMOJIS.length],
        photoUrl: employee.photo_url,
        phone: employee.phone,
        email: employee.email,
        gender: employee.gender,
        bloodGroup: employee.blood_group,
        emergencyContact: employee.emergency_contact,
        managerName: employee.manager_name,
        stats: statsByName.get(name.toLowerCase()) ?? emptyAgentStat(employee.id, name, employee.role),
      };
    });
}

// ---------------------------------------------------------------------------
// Gamification — "Star of the Month"
// ---------------------------------------------------------------------------

export interface TopPerformer {
  id: string;
  name: string;
  /** Which metric crowned them, so the UI can word the badge correctly. */
  metric: "surgeries" | "consultations";
  surgeries: number;
  consultations: number;
  leads: number;
}

/**
 * Crowns the agent with the most completed surgeries, falling back to
 * consultations, then total leads, then alphabetical order. Agents who have not
 * touched a single lead are skipped so an empty roster never shows a crown on
 * somebody with zero activity.
 */
export function findTopPerformer(agents: AgentStat[]): TopPerformer | null {
  let best: AgentStat | null = null;
  for (const stat of agents) {
    if (stat.leads <= 0 && stat.surgeries <= 0 && stat.consultations <= 0) continue;
    if (!best) {
      best = stat;
      continue;
    }
    const better =
      stat.surgeries !== best.surgeries
        ? stat.surgeries > best.surgeries
        : stat.consultations !== best.consultations
          ? stat.consultations > best.consultations
          : stat.leads !== best.leads
            ? stat.leads > best.leads
            : stat.name.localeCompare(best.name) < 0;
    if (better) best = stat;
  }
  if (!best) return null;
  return {
    id: best.id,
    name: best.name,
    metric: best.surgeries > 0 ? "surgeries" : "consultations",
    surgeries: best.surgeries,
    consultations: best.consultations,
    leads: best.leads,
  };
}

// ---------------------------------------------------------------------------
// Filter bar helpers
// ---------------------------------------------------------------------------

export interface DashboardFilters {
  city: string;
  source: string;
  treatment: string;
  agent: string;
  /** ISO yyyy-mm-dd, empty = use the dashboard range. */
  from: string;
  to: string;
}

export const ALL_FILTER_VALUE = "all";

export function emptyFilters(range: DateRange): DashboardFilters {
  return {
    city: ALL_FILTER_VALUE,
    source: ALL_FILTER_VALUE,
    treatment: ALL_FILTER_VALUE,
    agent: ALL_FILTER_VALUE,
    from: range.from,
    to: range.to,
  };
}

export interface FilterOptions {
  cities: string[];
  sources: string[];
  treatments: string[];
  agents: string[];
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value && value !== "-"))].sort((a, b) =>
    a.localeCompare(b),
  );
}

export function collectFilterOptions(rows: AnalyticsLead[]): FilterOptions {
  return {
    cities: uniqueSorted(rows.map((row) => row.city)),
    sources: uniqueSorted(rows.map((row) => row.source)),
    // The raw treatment string (treatment_type → treatment → disease), so the
    // dropdown mirrors exactly what the pipeline chart groups.
    treatments: uniqueSorted(rows.map((row) => row.treatment || row.disease)),
    agents: uniqueSorted(rows.map((row) => row.assigned_to)),
  };
}

export function applyFilters(rows: AnalyticsLead[], filters: DashboardFilters): AnalyticsLead[] {
  return rows.filter((row) => {
    if (filters.city !== ALL_FILTER_VALUE && row.city.trim() !== filters.city) return false;
    if (filters.source !== ALL_FILTER_VALUE && row.source.trim() !== filters.source) return false;
    // Case-insensitive treatment match ("LASIK" filter accepts "lasik"/"Lasik").
    if (filters.treatment !== ALL_FILTER_VALUE) {
      const selected = filters.treatment.trim().toLowerCase();
      const treatment = (row.treatment || row.disease).trim().toLowerCase();
      if (treatment !== selected && canonicalTreatment(treatment).key !== selected) return false;
    }
    if (filters.agent !== ALL_FILTER_VALUE && row.assigned_to.trim() !== filters.agent) return false;
    const date = parseLeadDateText(row.lead_date);
    if (date) {
      const from = parseIsoDate(filters.from);
      const to = parseIsoDate(filters.to);
      if (from && date < from) return false;
      if (to) {
        const end = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59);
        if (date > end) return false;
      }
    }
    return true;
  });
}

/** Range used by the trend chart: the filter bar dates, falling back to the header range. */
export function effectiveRange(range: DateRange, filters: DashboardFilters): DateRange {
  return { from: filters.from || range.from, to: filters.to || range.to };
}
export interface AgentCard {
  id: string;
  name: string;
  role: string;
  emoji: string;
  photoUrl: string | null;
  phone: string | null;
  email: string | null;
  gender: string | null;
  bloodGroup: string | null;
  emergencyContact: string | null;
  managerName: string | null;
  stats: AgentStat;
}
