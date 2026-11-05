export type DailyWorkKind = "assigned" | "opd" | "opdDone" | "ipd" | "ipdDone";

export const DAILY_WORK_LABELS: Record<DailyWorkKind, string> = {
  assigned: "New assignments",
  opd: "OPD appointments",
  opdDone: "OPD completed",
  ipd: "IPD appointments",
  ipdDone: "IPD completed",
};

export function isDailyWorkKind(value: string): value is DailyWorkKind {
  return value === "assigned" || value === "opd" || value === "opdDone" || value === "ipd" || value === "ipdDone";
}

export function isWorkDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** IST midnight through the next midnight, including no part of the next day. */
export function assignmentDayWindow(day: string): { from: string; to: string } {
  if (!isWorkDate(day)) throw new Error("Invalid work date");
  const from = new Date(`${day}T00:00:00+05:30`);
  return { from: from.toISOString(), to: new Date(from.getTime() + 86_400_000).toISOString() };
}

interface DailyQuery<Q> {
  gte(column: string, value: string): Q;
  lt(column: string, value: string): Q;
  eq(column: string, value: string): Q;
  or(expression: string): Q;
}

/** Counts and paginated calling lists share these exact date conditions. */
export function applyDailyWorkFilter<Q extends DailyQuery<Q>>(query: Q, work: DailyWorkKind, day: string): Q {
  if (!isWorkDate(day)) throw new Error("Invalid work date");
  if (work === "assigned") {
    const window = assignmentDayWindow(day);
    return query.gte("assigned_at", window.from).lt("assigned_at", window.to);
  }
  if (work === "opd") {
    // One lead appears once even if both OPD dates fall on the same day.
    return query.or(`opd_booked_date.eq.${day},opd_done_date.eq.${day}`);
  }
  if (work === "opdDone") return query.eq("opd_done_date", day);
  return query.eq("ipd_done_date", day);
}

/**
 * Today's New Leads are untouched assignments made today plus untouched
 * unassigned leads created today, not rows whose imported disposition happens
 * to say "New". The same predicate drives counts and the New Leads drill-down.
 */
export function applyCurrentNewLeadFilter<Q extends DailyQuery<Q>>(query: Q, day: string): Q {
  const window = assignmentDayWindow(day);
  return query
    .eq("workflow_bucket", "fresh")
    .or(
      `and(assigned_fresh_since.gte.${window.from},assigned_fresh_since.lt.${window.to}),` +
      `and(fresh_pending_since.gte.${window.from},fresh_pending_since.lt.${window.to},` +
      "or(assigned_to.is.null,assigned_to.eq.-,assigned_to.eq.unassigned))",
    );
}

/** Older untouched leads use their assignment date, or intake date if unassigned. */
export function olderFreshLeadFilter(day: string): string {
  const start = assignmentDayWindow(day).from;
  return `assigned_fresh_since.lt.${start},and(assigned_fresh_since.is.null,fresh_pending_since.lt.${start})`;
}

export interface LeadWorkflowFields {
  workflow_bucket?: string | null;
  assigned_fresh_since?: string | null;
  fresh_pending_since?: string | null;
  assigned_to?: string | null;
  status?: string | null;
}

/** Category label used on lead rows so status "New" cannot masquerade as Fresh. */
export function leadWorkflowLabel(lead: LeadWorkflowFields, today: string): string {
  const bucket = lead.workflow_bucket ?? "";
  if (bucket === "fresh") {
    const window = assignmentDayWindow(today);
    const since = lead.assigned_fresh_since ?? lead.fresh_pending_since ?? "";
    return since >= window.from && since < window.to ? "New" : "Fresh";
  }
  const status = (lead.status ?? "").trim();
  const defaultNewStatus = ["", "-", "--", "new", "new lead"].includes(status.toLowerCase());
  if (bucket === "followup" && defaultNewStatus && (lead.assigned_to ?? "").trim()) return "Follow-up";
  return status || "New";
}
