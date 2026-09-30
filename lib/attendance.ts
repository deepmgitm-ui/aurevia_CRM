// Aurevia CRM — attendance rules, kept free of Next/Supabase imports so the
// verifier (scripts/verify-attendance.mts) can pin the date math and the
// auto-check-in decisions without a database.
//
// The business rule the clinic asked for: an employee who signs in has marked
// themselves present, and the sign-in time IS the check-in time. A session that
// lived past midnight is dead, so the next request forces a fresh sign-in —
// which is what marks the new day.
export const ATTENDANCE_STATUSES = ["Present", "Absent", "Half-Day"] as const;

export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/** Clinic is on IST; "today" must mean the wall clock in Delhi, not UTC. */
export const CLINIC_TIME_ZONE = "Asia/Kolkata";

/**
 * The clinic date the current session was opened on, written by the login
 * action and read by the proxy. A mismatch with today means the session
 * outlived the night.
 *
 * It lives here rather than next to the login action because a "use server"
 * module may only export async functions — a plain constant exported from one
 * makes the whole module unreadable to the bundler.
 */
export const SESSION_DAY_COOKIE = "aurevia-session-day";

/** yyyy-mm-dd for the given instant, as seen in the clinic's timezone. */
export function clinicDate(instant: Date = new Date()): string {
  // en-CA renders ISO-shaped dates (2026-09-30), which is what we store.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CLINIC_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** "09:42" — the check-in time a manager reads off the calendar. */
export function formatClock(instant: string | Date): string {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: CLINIC_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** Minutes past midnight in the clinic's timezone (used for late marking). */
export function minutesIntoDay(instant: Date = new Date()): number {
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: CLINIC_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(instant);
  const [hour, minute] = clock.split(":").map(Number);
  return hour * 60 + minute;
}

export function isAttendanceStatus(value: unknown): value is AttendanceStatus {
  return (
    typeof value === "string" &&
    (ATTENDANCE_STATUSES as readonly string[]).includes(value)
  );
}

/** Normalises whatever the sheet/DB hands us into a printable status. */
export function normaliseStatus(value: unknown): AttendanceStatus {
  return isAttendanceStatus(value) ? value : "Present";
}

export interface AttendanceRow {
  id: string;
  employeeId: string;
  employeeName: string;
  /** yyyy-mm-dd. */
  date: string;
  status: AttendanceStatus;
  /** ISO timestamp of the automatic sign-in mark, when there was one. */
  checkInAt: string | null;
  /** "09:42" or "-" when the employee never signed in that day. */
  checkInLabel: string;
  note: string;
  /** True when the row came from a sign-in rather than a manager marking it. */
  autoMarked: boolean;
  /** Who set the current value (manager name), for the audit trail. */
  markedByName: string;
}

/** Sorts newest-first by check-in so the earliest starter reads at the top. */
export function sortByCheckIn(rows: AttendanceRow[]): AttendanceRow[] {
  return [...rows].sort((a, b) => {
    if (!a.checkInAt && !b.checkInAt) return a.employeeName.localeCompare(b.employeeName);
    if (!a.checkInAt) return 1;
    if (!b.checkInAt) return -1;
    return a.checkInAt.localeCompare(b.checkInAt);
  });
}

export interface MonthSummary {
  present: number;
  absent: number;
  halfDay: number;
  total: number;
}

/** Splits a roster into the people who have a mark and the ones who don't. */
export function splitRoster(
  roster: { employeeId: string }[],
  marks: Map<string, AttendanceStatus>,
): { marked: { employeeId: string; status: AttendanceStatus }[]; missing: { employeeId: string }[] } {
  const marked: { employeeId: string; status: AttendanceStatus }[] = [];
  const missing: { employeeId: string }[] = [];
  for (const member of roster) {
    const status = marks.get(member.employeeId);
    if (status) marked.push({ employeeId: member.employeeId, status });
    else missing.push(member);
  }
  return { marked, missing };
}

/** Month totals for the KPI strip, counting each status once. */
export function summariseMonth(rows: AttendanceRow[]): MonthSummary {
  const summary: MonthSummary = { present: 0, absent: 0, halfDay: 0, total: rows.length };
  for (const row of rows) {
    if (row.status === "Present") summary.present += 1;
    else if (row.status === "Absent") summary.absent += 1;
    else summary.halfDay += 1;
  }
  return summary;
}

/**
 * Did the sign-in happen on a NEW clinic day?
 *
 * The proxy stores the clinic date of the last sign-in in a cookie. A mismatch
 * (or a missing cookie on an already-signed-in visitor) means the session
 * crossed midnight, so the employee must sign in again — and that sign-in is
 * what marks the new day's attendance.
 */
export function needsFreshSignIn(stampedDate: string | undefined, now: Date = new Date()): boolean {
  if (!stampedDate) return true;
  return stampedDate !== clinicDate(now);
}
