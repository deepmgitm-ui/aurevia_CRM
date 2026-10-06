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

/** A calendar month represented as an inclusive start and exclusive end. */
export function attendanceMonthRange(
  month: string,
): { start: string; endExclusive: string } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;

  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (year < 1 || monthNumber < 1 || monthNumber > 12) return null;

  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  return {
    start: `${match[1]}-${match[2]}-01`,
    endExclusive: `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01`,
  };
}

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
 * Attendance rate as a whole percentage, where a half-day is worth half a
 * present.
 *
 * The denominator is the number of MARKS, not the number of days in the month.
 * That matters: we have no holiday calendar for the clinic, so dividing by 30
 * would quietly report healthy staff as absent for every Sunday. Counting only
 * the days somebody was actually marked keeps the number honest, and the card
 * shows "N din mark hue" right beside it so the denominator is never hidden.
 */
export function attendanceRate(summary: MonthSummary): number {
  if (summary.total === 0) return 0;
  const credit = summary.present + summary.halfDay / 2;
  return Math.round((credit / summary.total) * 100);
}

/** "Ravi Sharma" -> "RS"; "Chirag" -> "C". Used for the avatar fallback. */
export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export interface EmployeeAttendanceStats {
  employeeId: string;
  employeeName: string;
  present: number;
  halfDay: number;
  absent: number;
  total: number;
  /** Whole percentage — see attendanceRate for why the denominator is the marks. */
  rate: number;
  /** "09:42" mean check-in, or "-" when this person never signed in. */
  averageCheckIn: string;
  /** First and last sign-in of the month, "-" when there was none. */
  earliestCheckIn: string;
  latestCheckIn: string;
  /** Consecutive present/half days ending on the LAST marked day. */
  streak: number;
}

const MARKED_STATUSES: AttendanceStatus[] = ["Present", "Half-Day"];

/** "09:42" -> 582. "-" and anything unparsable -> null. */
function clockToMinutes(label: string): number | null {
  if (!/^\d{1,2}:\d{2}$/.test(label)) return null;
  const [hour, minute] = label.split(":").map(Number);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function minutesToClock(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  return `${String(hour).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Tolerant join: an unnamed row still groups under its own employee id. */
function groupByEmployee(rows: AttendanceRow[]): Map<string, AttendanceRow[]> {
  const grouped = new Map<string, AttendanceRow[]>();
  for (const row of rows) {
    const bucket = grouped.get(row.employeeId);
    if (bucket) bucket.push(row);
    else grouped.set(row.employeeId, [row]);
  }
  return grouped;
}

/**
 * Per-person totals for the profile cards, newest check-in first per person so
 * the streak walk below sees days in order.
 */
export function summariseByEmployee(rows: AttendanceRow[]): EmployeeAttendanceStats[] {
  return [...groupByEmployee(rows).entries()]
    .map(([employeeId, list]) => {
      const byDay = [...list].sort((a, b) => a.date.localeCompare(b.date));
      const summary = summariseMonth(byDay);

      const checkIns = byDay
        .map((row) => clockToMinutes(row.checkInLabel))
        .filter((value): value is number => value !== null);

      // The streak counts back from the most recent marked day, so an employee
      // on leave at the end of the month still shows the run they had built.
      let streak = 0;
      for (let index = byDay.length - 1; index >= 0; index -= 1) {
        if (MARKED_STATUSES.includes(byDay[index].status)) streak += 1;
        else break;
      }

      return {
        employeeId,
        employeeName: byDay[0]?.employeeName ?? "-",
        present: summary.present,
        halfDay: summary.halfDay,
        absent: summary.absent,
        total: summary.total,
        rate: attendanceRate(summary),
        averageCheckIn:
          checkIns.length === 0
            ? "-"
            : minutesToClock(Math.round(checkIns.reduce((a, b) => a + b, 0) / checkIns.length)),
        earliestCheckIn: checkIns.length === 0 ? "-" : minutesToClock(Math.min(...checkIns)),
        latestCheckIn: checkIns.length === 0 ? "-" : minutesToClock(Math.max(...checkIns)),
        streak,
      };
    })
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}

/**
 * The team cards, including employees who have NOT been marked at all this
 * month. Without them a newcomer silently vanishes from the register — the one
 * person a manager most needs to notice.
 */
export function buildTeamCards(
  roster: { id: string; name: string }[],
  rows: AttendanceRow[],
): EmployeeAttendanceStats[] {
  const measured = summariseByEmployee(rows);
  const measuredById = new Map(measured.map((entry) => [entry.employeeId, entry]));

  // The ROSTER name wins over the one denormalised onto the attendance row.
  // That join column is a snapshot: an employee who has since been renamed
  // would otherwise show two different names on the same screen.
  const named = measured.map((entry) => {
    const person = roster.find((candidate) => candidate.id === entry.employeeId);
    const rosterName = person?.name?.trim();
    return rosterName ? { ...entry, employeeName: rosterName } : entry;
  });

  const unmeasured = roster
    .filter((person) => !measuredById.has(person.id))
    .map<EmployeeAttendanceStats>((person) => ({
      employeeId: person.id,
      employeeName: person.name || "-",
      present: 0,
      halfDay: 0,
      absent: 0,
      total: 0,
      rate: 0,
      averageCheckIn: "-",
      earliestCheckIn: "-",
      latestCheckIn: "-",
      streak: 0,
    }));

  return [...named, ...unmeasured].sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}

/** This employee's status on one clinic day, or null when nothing is marked. */
export function statusOn(
  rows: AttendanceRow[],
  employeeId: string,
  date: string,
): AttendanceStatus | null {
  return rows.find((row) => row.employeeId === employeeId && row.date === date)?.status ?? null;
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
