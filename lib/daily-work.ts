export type DailyWorkKind = "assigned" | "opd" | "ipd";

export const DAILY_WORK_LABELS: Record<DailyWorkKind, string> = {
  assigned: "New assignments",
  opd: "OPD appointments",
  ipd: "IPD appointments",
};

export function isDailyWorkKind(value: string): value is DailyWorkKind {
  return value === "assigned" || value === "opd" || value === "ipd";
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
  return query.eq("ipd_done_date", day);
}
