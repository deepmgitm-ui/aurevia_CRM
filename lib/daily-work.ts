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

const TASK_PAGE_BUCKETS = ["all", "overdue", "today", "upcoming", "stale"];
export function isValidTaskPageRequest(bucket: unknown, search: unknown, page: unknown): boolean {
  return typeof bucket === "string" && TASK_PAGE_BUCKETS.includes(bucket) &&
    typeof search === "string" && typeof page === "number" &&
    Number.isSafeInteger(page) && page >= 1 && page <= 100_000;
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

const CLINIC_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function clinicDateKey(instant: Date): string {
  return CLINIC_DATE_FORMATTER.format(instant);
}

/** Current clinic-day bounds in India Standard Time. */
export function clinicDayBounds(now: Date | number = Date.now()): { from: string; to: string } {
  const instant = typeof now === "number" ? now : now.getTime();
  const day = clinicDateKey(new Date(instant));
  const start = new Date(`${day}T00:00:00.000+05:30`);
  return { from: start.toISOString(), to: new Date(start.getTime() + 86_400_000).toISOString() };
}

/** Historic assignment lists use assigned_at; appointment lists use the RLS-scoped CRM appointment RPC. */
export function applyAssignmentDayFilter<Q extends DailyQuery<Q>>(query: Q, day: string): Q {
  const window = assignmentDayWindow(day);
  return query.gte("assigned_at", window.from).lt("assigned_at", window.to);
}

/** Fresh means an untouched lead received during today's India clinic date. */
export function applyDailyFreshLeadFilter<Q extends DailyQuery<Q>>(query: Q, now: Date | number = Date.now()): Q {
  const { from, to } = clinicDayBounds(now);
  return query.eq("workflow_bucket", "fresh").gte("fresh_pending_since", from).lt("fresh_pending_since", to);
}

/** New means untouched leads received before today's India clinic date. */
export function applyUntouchedNewLeadFilter<Q extends DailyQuery<Q>>(query: Q, now: Date | number = Date.now()): Q {
  const { from } = clinicDayBounds(now);
  return query.eq("workflow_bucket", "fresh").lt("fresh_pending_since", from);
}

export interface LeadWorkflowFields {
  workflow_bucket?: string | null;
  assigned_fresh_since?: string | null;
  fresh_pending_since?: string | null;
  created_at?: string | null;
  assigned_to?: string | null;
  status?: string | null;
}

/** Today's untouched leads are Fresh; older untouched leads are New. */
export function leadWorkflowLabel(lead: LeadWorkflowFields, now: Date | number = Date.now()): string {
  const bucket = lead.workflow_bucket ?? "";
  if (bucket === "fresh") {
    const since = lead.fresh_pending_since ?? lead.assigned_fresh_since ?? lead.created_at ?? "";
    const instant = typeof now === "number" ? now : now.getTime();
    const intakeTime = Date.parse(since);
    return Number.isFinite(intakeTime) && clinicDateKey(new Date(intakeTime)) === clinicDateKey(new Date(instant))
      ? "Fresh"
      : "New";
  }
  const status = (lead.status ?? "").trim();
  const defaultNewStatus = ["", "-", "--", "new", "new lead"].includes(status.toLowerCase());
  if (bucket === "followup" && defaultNewStatus && (lead.assigned_to ?? "").trim()) return "Follow-up";
  return status || "New";
}
