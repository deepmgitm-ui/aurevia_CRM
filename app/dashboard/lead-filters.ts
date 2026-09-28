// Explicit .ts extension: Node's ESM loader (used by scripts/verify-lead-filters.mts)
// cannot resolve extensionless specifiers, and Next's bundler accepts either.
import { PIPELINE_STAGES, TREATMENT_LABELS, type StageKey } from "./overview/analytics.ts";

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

// Ordered exactly as the product asked: today → yesterday → 2..6 days →
// 1 week → 2 weeks → 3 weeks → then month-wise (older).
export const AGE_BUCKETS: AgeBucketDefinition[] = [
  { key: "today", label: "Today", short: "Today", minDays: 0, maxDays: 0 },
  { key: "yesterday", label: "Yesterday", short: "Yesterday", minDays: 1, maxDays: 1 },
  { key: "d2", label: "2 days ago", short: "2d", minDays: 2, maxDays: 2 },
  { key: "d3", label: "3 days ago", short: "3d", minDays: 3, maxDays: 3 },
  { key: "d4", label: "4 days ago", short: "4d", minDays: 4, maxDays: 4 },
  { key: "d5", label: "5 days ago", short: "5d", minDays: 5, maxDays: 5 },
  { key: "d6", label: "6 days ago", short: "6d", minDays: 6, maxDays: 6 },
  { key: "w1", label: "1 week ago", short: "1w", minDays: 7, maxDays: 13 },
  { key: "w2", label: "2 weeks ago", short: "2w", minDays: 14, maxDays: 20 },
  { key: "w3", label: "3 weeks ago", short: "3w", minDays: 21, maxDays: 27 },
  { key: "older", label: "Older (month-wise)", short: "Month", minDays: 28, maxDays: null },
];

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

