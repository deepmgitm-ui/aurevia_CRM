// Explicit .ts extension: Node's ESM loader (used by scripts/verify-lead-filters.mts)
// cannot resolve extensionless specifiers, and Next's bundler accepts either.
import {
  PIPELINE_STAGES,
  TREATMENT_LABELS,
  UNRECORDED_TREATMENT_KEY,
  canonicalTreatment,
  stageForStatus,
  type AnalyticsLead,
  type StageKey,
} from "./overview/analytics.ts";

// ---------------------------------------------------------------------------
// Aurevia CRM — Lead list filters + age buckets.
//
// Deliberately pure and dependency-free (no "use client" / "use server") so BOTH
// the server components (parsing ?stage=&treatment=&age= from the URL) and the
// client components (building the drill-down links) share one definition of
// every filter. A link built here parses back to exactly the same filter set —
// that is what makes "chart pe click karo, list aa jaaye" reliable.
// ---------------------------------------------------------------------------

export type AgeBucketKey =
  | "today"
  | "yesterday"
  | "d2"
  | "d3"
  | "d4"
  | "d5"
  | "d6"
  | "d7"
  | "w1"
  | "w2"
  | "w3"
  | "older";

export interface AgeBucketDefinition {
  key: AgeBucketKey;
  label: string;
  /** Inclusive day offsets (0 = today, 1 = yesterday, 7 = a week ago). */
  minDays: number;
  maxDays: number | null;
  /** Short label for the compact chips row. */
  short: string;
}

// The ladder the team asked for: today → 1 day ago → 2…7 days ago → 1 week →
// 2 weeks → 3 weeks → everything older (4+ weeks), which the UI offers as a
// MONTH PICKER rather than one vague "Month" chip — see `monthFilterKey`.
export const AGE_BUCKETS: AgeBucketDefinition[] = [
  { key: "today", label: "Today", short: "Today", minDays: 0, maxDays: 0 },
  { key: "yesterday", label: "1 day ago (Yesterday)", short: "1d", minDays: 1, maxDays: 1 },
  { key: "d2", label: "2 days ago", short: "2d", minDays: 2, maxDays: 2 },
  { key: "d3", label: "3 days ago", short: "3d", minDays: 3, maxDays: 3 },
  { key: "d4", label: "4 days ago", short: "4d", minDays: 4, maxDays: 4 },
  { key: "d5", label: "5 days ago", short: "5d", minDays: 5, maxDays: 5 },
  { key: "d6", label: "6 days ago", short: "6d", minDays: 6, maxDays: 6 },
  { key: "d7", label: "7 days ago", short: "7d", minDays: 7, maxDays: 7 },
  { key: "w1", label: "1 week ago", short: "1w", minDays: 8, maxDays: 13 },
  { key: "w2", label: "2 weeks ago", short: "2w", minDays: 14, maxDays: 20 },
  { key: "w3", label: "3 weeks ago", short: "3w", minDays: 21, maxDays: 27 },
  { key: "older", label: "4+ weeks old", short: "4w+", minDays: 28, maxDays: null },
];

/**
 * The buckets rendered as chips. "older" is deliberately NOT here: it is the
 * catch-all for everything past 3 weeks, and a chip reading just "older" tells
 * the team nothing. That span is served by the month picker instead, which
 * names the actual month.
 */
export const AGE_CHIP_BUCKETS: AgeBucketDefinition[] = AGE_BUCKETS.filter(
  (bucket) => bucket.key !== "older",
);

const AGE_BUCKET_MAP = new Map(AGE_BUCKETS.map((bucket) => [bucket.key, bucket]));

export function ageBucketDefinition(key: string): AgeBucketDefinition | null {
  return AGE_BUCKET_MAP.get(key as AgeBucketKey) ?? null;
}

export function ageBucketLabel(key: string): string {
  return ageBucketDefinition(key)?.label ?? "All time";
}

/** Whole days between two dates, ignoring the time of day (local calendar). */
export function daysBetween(from: Date, to: Date): number {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((end - start) / 86_400_000);
}

/**
 * Bucket for one lead date: today, yesterday, 2–6 days ago, 1/2/3 weeks ago, or
 * "older" (the UI then groups those month-wise).
 */
export function ageBucketFor(date: Date | null, today = new Date()): AgeBucketKey | null {
  if (!date) return null;
  const days = daysBetween(date, today);
  if (days < 0) return "today"; // future-dated rows stay visible
  const bucket = AGE_BUCKETS.find(
    (candidate) => days >= candidate.minDays && (candidate.maxDays === null || days <= candidate.maxDays),
  );
  return bucket?.key ?? "older";
}

/** "Sep 2026" — the month-wise grouping label for the "older" bucket. */
export function ageMonthLabel(date: Date): string {
  return date.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Month picker — the filter the team asked for instead of a vague "Month" chip
// ---------------------------------------------------------------------------

/** "2026-03" for one date, in the server's local calendar. */
export function monthFilterKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** True for a well-formed `?month=` value; anything else is ignored, not shown. */
export function isMonthFilterKey(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value.trim());
}

/** "Mar 2026" — what the month dropdown and the active-filter chip show. */
export function monthFilterLabel(key: string): string {
  if (!isMonthFilterKey(key)) return "All time";
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
  });
}

/**
 * The calendar month a key names, as a `created_at` window.
 *
 * Inclusive of the whole month: from the 1st at 00:00 local to the 1st of the
 * next month at 00:00 (exclusive), which sidesteps the "31 days" guess that a
 * February would get wrong.
 */
export function monthWindow(key: string): AgeWindow | null {
  if (!isMonthFilterKey(key)) return null;
  const [year, month] = key.split("-").map(Number);
  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 1);
  return { fromIso: from.toISOString(), toIso: to.toISOString() };
}

// ---------------------------------------------------------------------------
// "Added 2 days ago" — the human age of one lead
// ---------------------------------------------------------------------------

/** Leads this fresh wear the green NEW pill (today, yesterday, 2 days ago). */
export const NEW_LEAD_WINDOW_DAYS = 2;

const EMPTY_DATE_VALUES = new Set(["-", "--", ".", "n/a", "na", "nil", "null", "none", "unknown"]);

/**
 * Parses every date format this CRM actually stores: `DD/MM/YYYY` (Excel imports
 * and the Meta webhook), `YYYY-MM-DD` (native date pickers) and full ISO
 * timestamps (`created_at`). Placeholders ("-", "", "N/A") return `null`, so
 * callers can simply skip the label instead of rendering "Added NaN days ago".
 */
export function parseLeadDateValue(value: Date | string | null | undefined): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value ?? "").trim();
  if (!text || EMPTY_DATE_VALUES.has(text.toLowerCase())) return null;

  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const dmy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Whole days a lead has been in the CRM (0 = today, negative = future-dated). */
export function leadAgeInDays(value: Date | string | null | undefined, today = new Date()): number | null {
  const date = parseLeadDateValue(value);
  return date ? daysBetween(date, today) : null;
}

/** TRUE for a lead inside the NEW window — the leads table highlights these rows. */
export function isNewLead(value: Date | string | null | undefined, today = new Date()): boolean {
  const days = leadAgeInDays(value, today);
  return days !== null && days >= 0 && days <= NEW_LEAD_WINDOW_DAYS;
}

/**
 * "Added today" → "Added yesterday" → "Added 2…6 days ago" → "Added 1/2/3 weeks
 * ago" → "Added N months ago" → "Added N years ago". Exactly the ladder the team
 * asked for, so an old lead can never look like a fresh one again.
 */
export function relativeLeadAge(value: Date | string | null | undefined, today = new Date()): string | null {
  const days = leadAgeInDays(value, today);
  if (days === null) return null;
  if (days < 0) {
    const ahead = Math.abs(days);
    return `In ${ahead} ${ahead === 1 ? "day" : "days"}`;
  }
  if (days === 0) return "Added today";
  if (days === 1) return "Added yesterday";
  if (days <= 6) return `Added ${days} days ago`;
  if (days <= 13) return "Added 1 week ago";
  if (days <= 20) return "Added 2 weeks ago";
  if (days <= 27) return "Added 3 weeks ago";

  const months = Math.round(days / 30.44);
  if (months <= 11) return `Added ${months} ${months === 1 ? "month" : "months"} ago`;

  const years = Math.max(1, Math.round(days / 365.25));
  return `Added ${years} ${years === 1 ? "year" : "years"} ago`;
}

/** Compact twin for narrow cells and chips: "today", "yest.", "3d ago", "1w ago". */
export function shortLeadAge(value: Date | string | null | undefined, today = new Date()): string | null {
  const days = leadAgeInDays(value, today);
  if (days === null) return null;
  if (days < 0) return `in ${Math.abs(days)}d`;
  if (days === 0) return "today";
  if (days === 1) return "yest.";
  if (days <= 6) return `${days}d ago`;
  if (days <= 27) return `${Math.round(days / 7)}w ago`;
  const months = Math.round(days / 30.44);
  if (months <= 11) return `${months}mo ago`;
  return `${Math.max(1, Math.round(days / 365.25))}y ago`;
}

// ---------------------------------------------------------------------------
// Lead list filters (?stage=&treatment=&age=&city=&source=&assigned=&q=)
// ---------------------------------------------------------------------------

export interface LeadListFilters {
  /** Free-text search (name / phone / treatment). */
  q: string;
  /** Pipeline stage key(s), comma-separated for KPI cards (new | contacted | booked | attended | surgery | lost). */
  stage: string;
  /** Treatment series key from the charts (lasik | cataract | icl | retina | other | unrecorded | free-text slug). */
  treatment: string;
  /**
   * Comma-separated series keys that ARE rendered as their own bars — only sent
   * alongside `treatment=other` so the server can resolve the folded "Other"
   * segment back to the exact treatments the chart folded away.
   */
  except: string;
  /** Age bucket key from AGE_BUCKETS. */
  age: string;
  /** Calendar month the lead was added, `2026-03` — the month picker. */
  month: string;
  /** Exact city / source / agent + raw status, straight from the URL. */
  city: string;
  source: string;
  assigned: string;
  status: string;
}

export const EMPTY_LEAD_FILTERS: LeadListFilters = {
  q: "",
  stage: "",
  treatment: "",
  except: "",
  age: "",
  month: "",
  city: "",
  source: "",
  assigned: "",
  status: "",
};

type SearchParamsLike = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return (value[0] ?? "").trim();
  return (value ?? "").trim();
}

export function parseLeadFilters(params: SearchParamsLike): LeadListFilters {
  return {
    q: firstValue(params.q),
    stage: firstValue(params.stage),
    treatment: firstValue(params.treatment),
    except: firstValue(params.except),
    age: firstValue(params.age),
    month: isMonthFilterKey(firstValue(params.month)) ? firstValue(params.month) : "",
    city: firstValue(params.city),
    source: firstValue(params.source),
    assigned: firstValue(params.assigned),
    status: firstValue(params.status),
  };
}

/** True when at least one drill-down filter is active (drives the summary bar). */
export function hasLeadFilters(filters: LeadListFilters): boolean {
  return (
    filters.q.length > 0 ||
    filters.stage.length > 0 ||
    filters.treatment.length > 0 ||
    filters.age.length > 0 ||
    filters.month.length > 0 ||
    filters.city.length > 0 ||
    filters.source.length > 0 ||
    filters.assigned.length > 0 ||
    filters.status.length > 0
  );
}

/**
 * Builds `/dashboard/leads?...` for a chart segment, KPI card or table row.
 * Empty/undefined values are dropped so two links that mean the same thing
 * produce the same URL (React keys + browser history stay clean).
 */
export function leadsHref(filters: Partial<LeadListFilters>): string {
  const params = new URLSearchParams();
  const treatment = String(filters.treatment ?? "").trim();
  for (const [key, value] of Object.entries(filters)) {
    const text = String(value ?? "").trim();
    if (!text) continue;
    // `except` only means anything together with treatment=other.
    if (key === "except" && !treatment) continue;
    params.set(key, text);
  }
  const query = params.toString();
  return query ? `/dashboard/leads?${query}` : "/dashboard/leads";
}

// ---------------------------------------------------------------------------
// Stage + treatment labels (so a chip reads "Surgery Completed", not "surgery")
// ---------------------------------------------------------------------------

/** Every stage a drill-down can target — the five funnel stages plus Lost/Dropped. */
export const STAGE_KEYS: readonly StageKey[] = [...PIPELINE_STAGES.map((stage) => stage.key), "lost"];

const STAGE_LABELS: Record<string, string> = {
  ...Object.fromEntries(PIPELINE_STAGES.map((stage) => [stage.key, stage.label])),
  lost: "Lost / Dropped",
};

/** Splits `?stage=booked,attended,surgery` into the valid keys only. */
export function stageFilterKeys(stage: string): StageKey[] {
  const wanted = new Set(stage.split(",").map((key) => key.trim().toLowerCase()).filter(Boolean));
  return STAGE_KEYS.filter((key) => wanted.has(key));
}

/** "eye-checkup" → "Eye checkup" — for free-text treatment series the charts discover. */
export function prettifyFilterKey(key: string): string {
  const words = key.replace(/[-_]+/g, " ").trim();
  if (!words) return key;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Merged stage + treatment label lookup used by every drill-down chip/banner. */
export function filterChipLabels(): Record<string, string> {
  return { ...TREATMENT_LABELS, ...STAGE_LABELS };
}

/**
 * Human summary for the filtered-list header, e.g.
 * ["LASIK", "Surgery Completed", "Today"] — free-text keys fall back to a
 * prettified version of the slug so no chip ever renders a raw URL value.
 */
export function describeActiveFilters(filters: LeadListFilters): string[] {
  const labels = filterChipLabels();
  const chips: string[] = [];
  for (const key of stageFilterKeys(filters.stage)) chips.push(labels[key] ?? prettifyFilterKey(key));
  if (filters.treatment) chips.push(labels[filters.treatment] ?? prettifyFilterKey(filters.treatment));
  if (filters.age) chips.push(ageBucketLabel(filters.age));
  if (filters.month) chips.push(monthFilterLabel(filters.month));
  if (filters.city) chips.push(filters.city);
  if (filters.source) chips.push(filters.source);
  if (filters.assigned) chips.push(filters.assigned);
  if (filters.status) chips.push(filters.status);
  if (filters.q) chips.push(`Search: ${filters.q}`);
  return chips;
}

// ---------------------------------------------------------------------------
// Age bucket → created_at window (server-side twin of `ageBucketFor`)
// ---------------------------------------------------------------------------

export interface AgeWindow {
  /** Inclusive lower bound (ISO timestamptz) — `null` for the open-ended "older" bucket. */
  fromIso: string | null;
  /** Exclusive upper bound (ISO timestamptz). */
  toIso: string | null;
}

/**
 * The `created_at` range that matches one age bucket, computed on the SERVER in
 * the server's local calendar (the same whole-day maths `ageBucketFor` does in
 * the browser). Both bounds are instants, so timezone skew only matters for the
 * few hours either side of a bucket boundary.
 */
export function ageBucketWindow(key: string, today = new Date()): AgeWindow | null {
  const bucket = ageBucketDefinition(key);
  if (!bucket) return null;
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  // Exclusive upper bound: the earliest instant that is still `minDays` old.
  const to = new Date(startOfToday);
  to.setDate(to.getDate() - bucket.minDays + 1);
  const from = new Date(startOfToday);
  if (bucket.maxDays !== null) from.setDate(from.getDate() - bucket.maxDays);
  return {
    fromIso: bucket.maxDays === null ? null : from.toISOString(),
    toIso: to.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Server-side treatment matching (best-effort SQL mirror of chart grouping)
// ---------------------------------------------------------------------------

// Kept deliberately in sync with TREATMENT_PATTERNS in ./overview/analytics.ts —
// one keyword list per treatment family so a drill-down list matches the bar the
// admin clicked (typo-tolerant spellings included).
export const TREATMENT_SQL_PATTERNS: Record<string, string[]> = {
  lasik: ["%lasik%", "%lasic%", "%lasek%", "%lazik%", "%lasix%", "%laser%", "%femto%", "%contoura%", "%wavefront%", "%prk%", "%refractiv%", "%smile%"],
  cataract: ["%cataract%", "%catract%", "%catarct%", "%cateract%", "%motiyabind%", "%motia%", "%phaco%", "%iol%", "%intraocular%", "%intra ocular%", "%lens%", "%toric%"],
  icl: ["%icl%", "%icle%", "%implant%", "%phakic%", "%collamer%"],
  retina: ["%retina%", "%vitreous%", "%macula%", "%diabet%"],
  keratoconus: ["%keratoconus%", "%cross link%", "%crosslink%"],
  squint: ["%squint%", "%strabismus%"],
  glaucoma: ["%glaucoma%"],
  pterygium: ["%pterygium%"],
  dcr: ["%dcr%", "%dacryo%", "%watering eye%"],
  oculoplasty: ["%ptosis%", "%oculoplasty%", "%chalazion%", "%dermoid%"],
  spectacles: ["%spectacle%", "%glasses%", "%specs%", "%power%"],
};

export function treatmentSqlPatterns(family: string): string[] {
  return TREATMENT_SQL_PATTERNS[family.trim().toLowerCase()] ?? [];
}

export function isUnrecordedTreatment(family: string): boolean {
  return family.trim().toLowerCase() === "unrecorded";
}

/**
 * PostgREST `.or()` expression for a treatment family across every column the
 * CRM might store it in — the safety net for rows written after the
 * distinct-value cache was built (and for `remarks`-only treatments).
 * `null` means "this family has no keyword list" (free-text / other / unrecorded).
 */
export function treatmentOrExpression(family: string, columns: string[] = ["disease", "remarks"]): string | null {
  const patterns = treatmentSqlPatterns(family);
  if (patterns.length === 0) return null;
  const clauses: string[] = [];
  for (const column of columns) {
    for (const pattern of patterns) clauses.push(`${column}.ilike.${pattern}`);
  }
  return clauses.join(",");
}

/**
 * Placeholder treatments that mean "the field was never filled in" — mirrors
 * GENERIC_TREATMENT_VALUES in ./overview/analytics.ts.
 */
export const UNRECORDED_TREATMENT_VALUES = [
  "",
  "-",
  "--",
  ".",
  "na",
  "n/a",
  "none",
  "nil",
  "null",
  "unknown",
  "not applicable",
];

/**
 * Quotes every value for use inside `in.(...)`. PostgREST treats
 * `, ( ) . : *` and whitespace as reserved inside a filter value, so anything
 * carrying one gets wrapped in double quotes (embedded quotes are stripped —
 * status / treatment text never legitimately contains one).
 */
export function inListExpression(values: readonly string[]): string {
  return values
    .map((value) => {
      const safe = value.replace(/"/g, "");
      return /[,().:\s*]/.test(safe) ? `"${safe}"` : safe;
    })
    .join(",");
}

/** Escapes `%`, `_` and `\` so an ilike pattern matches literally. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[%_\\]/g, (char) => `\\${char}`).replace(/"/g, "");
}

/**
 * TRUE when `column` holds no usable treatment text — `NULL`, "" or "-".
 * This is the SQL twin of resolveTreatmentText()'s skip rule.
 */
export function blankColumnClause(column: string): string {
  return `or(${column}.is.null,${column}.in.(${inListExpression(["", "-"])}))`;
}

/** Joins clauses with AND, collapsing the single-clause case to itself. */
export function andClauses(clauses: string[]): string {
  if (clauses.length === 0) return "";
  return clauses.length === 1 ? clauses[0] : `and(${clauses.join(",")})`;
}

// ---------------------------------------------------------------------------
// Treatment-wise tally — "konsa lead kis treatment / disease ka hai"
// ---------------------------------------------------------------------------

export interface TreatmentTally {
  /** Exactly the key the charts (and the drill-down URL) use. */
  key: string;
  label: string;
  count: number;
}

/**
 * Mirrors the SQL drill-down filters for everything EXCEPT `treatment` itself, so
 * the chips can show "LASIK 41 · Cataract 22" for the current stage / city / age
 * selection and still be one click away from each other.
 */
function matchesTallyFilters(row: AnalyticsLead, filters: LeadListFilters, today: Date): boolean {
  const stages = stageFilterKeys(filters.stage);
  if (stages.length > 0 && !stages.includes(stageForStatus(row.status))) return false;

  const equals = (left: string, right: string) => left.trim().toLowerCase() === right.trim().toLowerCase();
  if (filters.city && !equals(row.city, filters.city)) return false;
  if (filters.source && !equals(row.source, filters.source)) return false;
  if (filters.status && !equals(row.status, filters.status)) return false;
  if (filters.assigned && !equals(row.assigned_to, filters.assigned)) return false;

  if (filters.age) {
    // Same bucket ladder the SQL window enforces; `lead_date` already falls back
    // to `created_at` inside toAnalyticsLead().
    if (ageBucketFor(parseLeadDateValue(row.lead_date), today) !== filters.age) return false;
  }

  if (filters.month) {
    // The month picker's client-side twin of the SQL window. An undated lead can
    // never satisfy a month selection, so it drops out rather than showing up in
    // every month at once.
    const date = parseLeadDateValue(row.lead_date);
    if (!date || monthFilterKey(date) !== filters.month) return false;
  }

  if (filters.q) {
    const needle = filters.q.trim().toLowerCase();
    const haystack = `${row.name} ${row.disease} ${row.treatment} ${row.city}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }

  return true;
}

/**
 * Counts leads per treatment for the current filter set. Free-text treatments
 * keep their own row (the same `canonicalTreatment` grouping the pipeline chart
 * uses), placeholders collapse into "Not Recorded", and the biggest treatment
 * always leads so the eye lands on it first.
 */
export function tallyTreatments(
  rows: AnalyticsLead[],
  filters: LeadListFilters = EMPTY_LEAD_FILTERS,
  today = new Date(),
): TreatmentTally[] {
  const counts = new Map<string, TreatmentTally>();
  for (const row of rows) {
    if (!matchesTallyFilters(row, filters, today)) continue;
    // `treatment` is the fully resolved text (all plausible columns + a remarks
    // fallback); `disease` is the second safety net.
    const { key, label } = canonicalTreatment(row.treatment || row.disease);
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { key, label, count: 1 });
  }

  return [...counts.values()].sort((left, right) => {
    // "Not Recorded" always sinks to the bottom — it is a data-quality hint, not
    // a treatment anyone would click first.
    if (left.key === UNRECORDED_TREATMENT_KEY) return 1;
    if (right.key === UNRECORDED_TREATMENT_KEY) return -1;
    return right.count - left.count || left.label.localeCompare(right.label);
  });
}

