"use server";

import { revalidatePath } from "next/cache";

import {
  attendanceMonthRange,
  attendanceExemptions,
  attendanceWeekStart,
  clinicDate,
  formatClock,
  isAttendanceStatus,
  normaliseStatus,
  sortByCheckIn,
  summariseMonth,
  type AttendanceRow,
  type AttendanceStatus,
  type AttendanceWeeklyOff,
  type ApprovedAttendanceLeave,
} from "@/lib/attendance";
import { createClient } from "@/lib/supabase/server";

export type AttendanceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/**
 * Shown instead of crashing the calendar when the migration isn't applied.
 *
 * This is the one string an engineer actually needs, so it names the file and
 * the two things the SQL must contain.
 */
const ATTENDANCE_TABLE_MISSING_ERROR =
  "Attendance cannot start yet — run supabase-hr-migration.sql in the Supabase SQL editor first (it creates the attendance table and the check_in_at columns).";

/** PostgREST wording for a missing relation/column, so we can say something useful. */
function isMissingTableError(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes("does not exist") ||
    text.includes("undefined table") ||
    text.includes("42p01") ||
    text.includes("42703") ||
    text.includes("pgrst204")
  );
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function getViewerContext(): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>;
  id: string;
  role: string;
} | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  return { supabase, id: user.id, role: profile?.role ?? "employee" };
}

function isManager(role: string): boolean {
  return role === "admin" || role === "manager";
}

function isAdmin(role: string): boolean {
  return role === "admin";
}

interface AttendanceDbRow {
  id: string;
  employee_id: string;
  attendance_date: string;
  status: string;
  check_in_at: string | null;
  note: string | null;
  auto_marked: boolean | null;
  employee: { name: string | null } | { name: string | null }[] | null;
  marker: { name: string | null } | { name: string | null }[] | null;
}

/** PostgREST returns a joined relation as an object or a one-item array. */
function joinedName(value: AttendanceDbRow["employee"]): string {
  if (Array.isArray(value)) return value[0]?.name ?? "-";
  return value?.name ?? "-";
}

function toAttendanceRow(row: AttendanceDbRow): AttendanceRow {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: joinedName(row.employee),
    date: String(row.attendance_date),
    status: normaliseStatus(row.status),
    checkInAt: row.check_in_at ?? null,
    checkInLabel: row.check_in_at ? formatClock(row.check_in_at) : "-",
    note: row.note ?? "",
    autoMarked: Boolean(row.auto_marked),
    markedByName: joinedName(row.marker),
  };
}

const SELECT_COLUMNS =
  "id, employee_id, attendance_date, status, check_in_at, note, auto_marked, employee:profiles!attendance_employee_id_fkey(name), marker:profiles!attendance_marked_by_fkey(name)";

const SELECT_COLUMNS_TABLE = "attendance";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

interface WeeklyOffDbRow {
  id: string;
  employee_id: string;
  week_start_date: string;
  off_date: string;
  note: string | null;
  employee: { name: string | null } | { name: string | null }[] | null;
}

interface ApprovedLeaveDbRow {
  id: string;
  employee_id: string;
  start_date: string;
  end_date: string;
  leave_type: ApprovedAttendanceLeave["leaveType"];
  duration: ApprovedAttendanceLeave["duration"];
  employee: { name: string | null } | { name: string | null }[] | null;
}

function toWeeklyOff(row: WeeklyOffDbRow): AttendanceWeeklyOff {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: joinedName(row.employee),
    weekStartDate: String(row.week_start_date),
    date: String(row.off_date),
    note: row.note ?? "",
  };
}

function toApprovedLeave(row: ApprovedLeaveDbRow): ApprovedAttendanceLeave {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: joinedName(row.employee),
    startDate: String(row.start_date),
    endDate: String(row.end_date),
    leaveType: row.leave_type,
    duration: row.duration,
  };
}

const WEEKLY_OFF_SELECT =
  "id, employee_id, week_start_date, off_date, note, employee:profiles!employee_weekly_offs_employee_id_fkey(name)";
const APPROVED_LEAVE_SELECT =
  "id, employee_id, start_date, end_date, leave_type, duration, employee:profiles!employee_leave_requests_employee_id_fkey(name)";

async function getScheduleForMonth(
  supabase: Awaited<ReturnType<typeof createClient>>,
  month: string,
  employeeId?: string,
): Promise<
  | { success: true; weeklyOffs: AttendanceWeeklyOff[]; approvedLeaves: ApprovedAttendanceLeave[] }
  | { success: false; error: string }
> {
  const range = attendanceMonthRange(month);
  if (!range) return { success: false, error: "Month must be a valid YYYY-MM value, such as 2026-09." };

  let offQuery = supabase
    .from("employee_weekly_offs")
    .select(WEEKLY_OFF_SELECT)
    .gte("off_date", range.start)
    .lt("off_date", range.endExclusive)
    .order("off_date", { ascending: true });
  let leaveQuery = supabase
    .from("employee_leave_requests")
    .select(APPROVED_LEAVE_SELECT)
    .eq("status", "Approved")
    .lt("start_date", range.endExclusive)
    .gte("end_date", range.start)
    .order("start_date", { ascending: true });
  if (employeeId) {
    offQuery = offQuery.eq("employee_id", employeeId);
    leaveQuery = leaveQuery.eq("employee_id", employeeId);
  }

  const [offs, leaves] = await Promise.all([offQuery, leaveQuery]);
  if (offs.error) return { success: false, error: getErrorMessage(offs.error, "Could not load weekly offs.") };
  if (leaves.error) return { success: false, error: getErrorMessage(leaves.error, "Could not load approved leave.") };

  return {
    success: true,
    weeklyOffs: ((offs.data ?? []) as unknown as WeeklyOffDbRow[]).map(toWeeklyOff),
    approvedLeaves: ((leaves.data ?? []) as unknown as ApprovedLeaveDbRow[]).map(toApprovedLeave),
  };
}

export interface AttendanceRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  reason: string;
  status: "Pending" | "Approved" | "Rejected";
  createdAt: string;
  reviewedAt: string | null;
  reviewNote: string;
}

interface AttendanceRequestDbRow {
  id: string;
  employee_id: string;
  employee_name?: string | null;
  attendance_date: string;
  reason: string | null;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  review_note: string | null;
  employee: { name: string | null } | { name: string | null }[] | null;
}

const REQUEST_SELECT =
  "id, employee_id, attendance_date, reason, status, created_at, reviewed_at, review_note, employee:profiles!attendance_requests_employee_id_fkey(name)";

function toAttendanceRequest(row: AttendanceRequestDbRow): AttendanceRequest {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: joinedName(row.employee),
    date: String(row.attendance_date),
    reason: row.reason ?? "",
    status: row.status === "Approved" || row.status === "Rejected" ? row.status : "Pending",
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note ?? "",
  };
}

/** Lists an employee's own requests or the team requests for admins/managers. */
export async function getAttendanceRequests(): Promise<AttendanceResult<AttendanceRequest[]>> {
  try {
    const viewer = await getViewerContext();
    if (!viewer) return { success: false, error: "Please sign in first." };

    let query = viewer.supabase
      .from("attendance_requests")
      .select(REQUEST_SELECT)
      .order("created_at", { ascending: false })
      .limit(100);
    if (!isManager(viewer.role)) query = query.eq("employee_id", viewer.id);

    const { data, error } = await query;
    if (error) {
      if (isMissingTableError(error.message)) {
        return {
          success: false,
          error: "Attendance requests are not enabled yet — run supabase-attendance-requests-migration.sql in the Supabase SQL editor.",
        };
      }
      return { success: false, error: getErrorMessage(error, "Could not load attendance requests.") };
    }
    return {
      success: true,
      data: ((data ?? []) as unknown as AttendanceRequestDbRow[]).map(toAttendanceRequest),
    };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not load attendance requests.") };
  }
}

/** Submits a request for a past day the employee attended but missed signing in. */
export async function createAttendanceRequest(input: {
  date: string;
  reason?: string;
}): Promise<AttendanceResult<AttendanceRequest>> {
  try {
    const viewer = await getViewerContext();
    if (!viewer) return { success: false, error: "Please sign in first." };
    if (isManager(viewer.role)) {
      return { success: false, error: "Admins and managers can mark attendance directly from the calendar." };
    }
    if (!DATE_PATTERN.test(input.date)) return { success: false, error: "Choose a valid attendance date." };
    if (input.date >= clinicDate()) {
      return { success: false, error: "You can request attendance only for a past date." };
    }
    const reason = input.reason?.trim() ?? "";
    if (reason.length > 1000) return { success: false, error: "Reason must be 1,000 characters or fewer." };

    const { data: existingAttendance, error: attendanceError } = await viewer.supabase
      .from("attendance")
      .select("id")
      .eq("employee_id", viewer.id)
      .eq("attendance_date", input.date)
      .maybeSingle();
    if (attendanceError) {
      if (isMissingTableError(attendanceError.message)) {
        return { success: false, error: ATTENDANCE_TABLE_MISSING_ERROR };
      }
      return { success: false, error: attendanceError.message };
    }
    if (existingAttendance) {
      return { success: false, error: "Attendance is already recorded for that date." };
    }

    const { data, error } = await viewer.supabase
      .from("attendance_requests")
      .insert({
        employee_id: viewer.id,
        attendance_date: input.date,
        reason,
      })
      .select(REQUEST_SELECT)
      .single();
    if (error) {
      if (isMissingTableError(error.message)) {
        return {
          success: false,
          error: "Attendance requests are not enabled yet — run supabase-attendance-requests-migration.sql in the Supabase SQL editor.",
        };
      }
      if (/duplicate|unique/i.test(error.message)) {
        return { success: false, error: "A request for this date is already pending review." };
      }
      return { success: false, error: error.message };
    }

    revalidatePath("/dashboard/attendance");
    return { success: true, data: toAttendanceRequest(data as unknown as AttendanceRequestDbRow) };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not submit the attendance request.") };
  }
}

/** Atomically approves/rejects a request; approval also records Present attendance. */
export async function reviewAttendanceRequest(input: {
  id: string;
  approved: boolean;
  reviewNote?: string;
}): Promise<AttendanceResult<{ id: string; status: "Approved" | "Rejected" }>> {
  try {
    const viewer = await getViewerContext();
    if (!viewer) return { success: false, error: "Please sign in first." };
    if (!isManager(viewer.role)) {
      return { success: false, error: "Only an admin or manager can review attendance requests." };
    }
    if (typeof input.id !== "string" || !input.id.trim()) {
      return { success: false, error: "Choose an attendance request." };
    }
    if (typeof input.approved !== "boolean") {
      return { success: false, error: "Choose whether to approve or reject the request." };
    }
    const reviewNote = input.reviewNote?.trim() ?? "";
    if (reviewNote.length > 1000) return { success: false, error: "Review note must be 1,000 characters or fewer." };

    const { data, error } = await viewer.supabase.rpc("review_attendance_request", {
      p_request_id: input.id,
      p_approved: input.approved,
      p_review_note: reviewNote || null,
    });
    if (error) {
      if (
        isMissingTableError(error.message) ||
        (/review_attendance_request/i.test(error.message) &&
          /function|schema cache|does not exist|could not find/i.test(error.message))
      ) {
        return {
          success: false,
          error: "Attendance request approval is not enabled yet — run supabase-attendance-requests-migration.sql in the Supabase SQL editor.",
        };
      }
      return { success: false, error: error.message };
    }
    if (data !== input.id) return { success: false, error: "The request could not be confirmed as reviewed." };

    revalidatePath("/dashboard/attendance");
    return { success: true, data: { id: input.id, status: input.approved ? "Approved" : "Rejected" } };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not review the attendance request.") };
  }
}

/**
 * Marks the signed-in employee present for today, recording the sign-in time.
 *
 * Called on the first dashboard render after a sign-in, which is the moment the
 * clinic counts as "the employee is in". Idempotent by design: the unique
 * (employee_id, attendance_date) index plus ignoreDuplicates means a second call
 * on the same day changes nothing — it can never move an existing check-in time
 * or add a second row for the day.
 */
export async function markMyAttendance(
  /**
   * The caller's own identity, when it already has it. The dashboard layout
   * loads the profile to render the shell, and looking it up a second time here
   * cost one extra round-trip on EVERY page load for no new information.
   */
  known?: { id: string; role: string },
): Promise<AttendanceResult<AttendanceRow | null>> {
  try {
    const viewer = known ? { id: known.id, role: known.role, supabase: null } : await getViewerContext();
    if (!viewer) return { success: true, data: null };
    const supabase = viewer.supabase ?? (await createClient());
    const today = clinicDate();

    // READ before writing. This runs on every dashboard request, and the day is
    // already marked after the first one, so the common path must not be a
    // write. A conditional upsert would still POST on every page load; this is
    // one SELECT instead, and the day's check-in time can never be disturbed.
    const { data: existing, error: readError } = await supabase
      .from(SELECT_COLUMNS_TABLE)
      .select(SELECT_COLUMNS)
      .eq("employee_id", viewer.id)
      .eq("attendance_date", today)
      .maybeSingle();

    if (readError) {
      if (isMissingTableError(readError.message)) {
        return { success: false, error: ATTENDANCE_TABLE_MISSING_ERROR };
      }
      return { success: false, error: getErrorMessage(readError, "Could not check attendance.") };
    }

    // Already checked in today — hand back what is stored, write nothing.
    if (existing) return { success: true, data: toAttendanceRow(existing as AttendanceDbRow) };

    // First sign-in of the day. ignoreDuplicates covers the race where two
    // requests (or two tabs) both reach this line at once: exactly one row.
    const { error } = await supabase.from(SELECT_COLUMNS_TABLE).upsert(
      {
        employee_id: viewer.id,
        attendance_date: today,
        status: "Present",
        check_in_at: new Date().toISOString(),
        auto_marked: true,
        note: null,
        marked_by: null,
      },
      { onConflict: "employee_id,attendance_date", ignoreDuplicates: true },
    );

    if (error) {
      if (isMissingTableError(error.message)) {
        return { success: false, error: ATTENDANCE_TABLE_MISSING_ERROR };
      }
      return { success: false, error: getErrorMessage(error, "Could not mark attendance.") };
    }

    const { data } = await supabase
      .from(SELECT_COLUMNS_TABLE)
      .select(SELECT_COLUMNS)
      .eq("employee_id", viewer.id)
      .eq("attendance_date", today)
      .maybeSingle();

    return { success: true, data: data ? toAttendanceRow(data as AttendanceDbRow) : null };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not mark attendance.") };
  }
}

/** The signed-in employee's own register for one month. */
export async function getMyAttendance(
  month: string,
): Promise<AttendanceResult<{
  month: string;
  rows: AttendanceRow[];
  weeklyOffs: AttendanceWeeklyOff[];
  approvedLeaves: ApprovedAttendanceLeave[];
}>> {
  try {
    const viewer = await getViewerContext();
    if (!viewer) return { success: false, error: "Please sign in first." };
    const range = attendanceMonthRange(month);
    if (!range) return { success: false, error: "Month must be a valid YYYY-MM value, such as 2026-09." };

    const [{ data, error }, schedule] = await Promise.all([
      viewer.supabase
      .from("attendance")
      .select(SELECT_COLUMNS)
      .eq("employee_id", viewer.id)
      .gte("attendance_date", range.start)
      .lt("attendance_date", range.endExclusive)
      .order("attendance_date", { ascending: false }),
      getScheduleForMonth(viewer.supabase, month, viewer.id),
    ]);

    if (error) {
      if (isMissingTableError(error.message)) {
        return { success: false, error: ATTENDANCE_TABLE_MISSING_ERROR };
      }
      return { success: false, error: getErrorMessage(error, "Could not load attendance.") };
    }
    if (!schedule.success) return { success: false, error: schedule.error };

    const rows = ((data ?? []) as AttendanceDbRow[]).map(toAttendanceRow);
    return {
      success: true,
      data: {
        month,
        rows: sortByCheckIn(rows),
        weeklyOffs: schedule.weeklyOffs,
        approvedLeaves: schedule.approvedLeaves,
      },
    };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not load attendance.") };
  }
}

/** The whole team's register for one month — admin/manager only. */
export async function getTeamAttendance(
  month: string,
): Promise<
  AttendanceResult<{
    month: string;
    rows: AttendanceRow[];
    summary: ReturnType<typeof summariseMonth>;
    weeklyOffs: AttendanceWeeklyOff[];
    approvedLeaves: ApprovedAttendanceLeave[];
  }>
> {
  try {
    const viewer = await getViewerContext();
    if (!viewer) return { success: false, error: "Please sign in first." };
    if (!isManager(viewer.role)) {
      return { success: false, error: "Only an admin or manager can view team attendance." };
    }
    const range = attendanceMonthRange(month);
    if (!range) return { success: false, error: "Month must be a valid YYYY-MM value, such as 2026-09." };

    const [{ data, error }, schedule] = await Promise.all([
      viewer.supabase
      .from("attendance")
      .select(SELECT_COLUMNS)
      .gte("attendance_date", range.start)
      .lt("attendance_date", range.endExclusive)
      .order("attendance_date", { ascending: false })
      .order("check_in_at", { ascending: true, nullsFirst: false }),
      getScheduleForMonth(viewer.supabase, month),
    ]);

    if (error) {
      if (isMissingTableError(error.message)) {
        return { success: false, error: ATTENDANCE_TABLE_MISSING_ERROR };
      }
      return { success: false, error: getErrorMessage(error, "Could not load attendance.") };
    }
    if (!schedule.success) return { success: false, error: schedule.error };

    const rows = ((data ?? []) as AttendanceDbRow[]).map(toAttendanceRow);
    const exemptedDays = attendanceExemptions(rows, schedule.weeklyOffs, schedule.approvedLeaves);
    return {
      success: true,
      data: {
        month,
        rows,
        summary: summariseMonth(rows, exemptedDays),
        weeklyOffs: schedule.weeklyOffs,
        approvedLeaves: schedule.approvedLeaves,
      },
    };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not load attendance.") };
  }
}

/**
 * ADDS a day the employee never signed in for (leave, or a missed sign-in) —
 * admin/manager only. Upserts, so marking a day that already has an automatic
 * check-in corrects it instead of failing.
 */
export async function markAttendance(
  input: { employeeId: string; date: string; status: AttendanceStatus; note?: string },
): Promise<AttendanceResult<AttendanceRow>> {
  try {
    const viewer = await getViewerContext();
    if (!viewer) return { success: false, error: "Please sign in first." };
    if (!isManager(viewer.role)) {
      return { success: false, error: "Only an admin or manager can change attendance." };
    }
    if (!input.employeeId) return { success: false, error: "Choose an employee." };
    if (!DATE_PATTERN.test(input.date)) {
      return { success: false, error: "Date must look like 2026-09-30." };
    }
    if (!isAttendanceStatus(input.status)) {
      return { success: false, error: "Choose one of Present, Absent or Half-Day." };
    }

    const { data, error } = await viewer.supabase
      .from("attendance")
      .upsert(
        {
          employee_id: input.employeeId,
          attendance_date: input.date,
          status: input.status,
          // A manager entry has no sign-in time of its own; the column is left
          // out so an existing real check-in time is never overwritten.
          marked_by: viewer.id,
          note: input.note?.trim() || null,
          auto_marked: false,
        },
        { onConflict: "employee_id,attendance_date" },
      )
      .select(SELECT_COLUMNS)
      .single();

    if (error) {
      if (isMissingTableError(error.message)) {
        return { success: false, error: ATTENDANCE_TABLE_MISSING_ERROR };
      }
      return { success: false, error: getErrorMessage(error, "Could not save attendance.") };
    }

    revalidatePath("/dashboard/attendance");
    return { success: true, data: toAttendanceRow(data as AttendanceDbRow) };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not save attendance.") };
  }
}

/**
 * MODIFIES an existing row in place (status / note). The check-in time is
 * deliberately NOT editable here: it is the employee's own sign-in, and letting
 * a manager retype it would quietly rewrite the audit trail. `auto_marked` is
 * left alone for the same reason.
 */
export async function updateAttendance(
  input: { id: string; status: AttendanceStatus; note?: string },
): Promise<AttendanceResult<AttendanceRow>> {
  try {
    const viewer = await getViewerContext();
    if (!viewer) return { success: false, error: "Please sign in first." };
    if (!isManager(viewer.role)) {
      return { success: false, error: "Only an admin or manager can change attendance." };
    }
    if (!input.id) return { success: false, error: "That attendance row no longer exists." };
    if (!isAttendanceStatus(input.status)) {
      return { success: false, error: "Choose one of Present, Absent or Half-Day." };
    }

    const { data, error } = await viewer.supabase
      .from("attendance")
      .update({
        status: input.status,
        note: input.note?.trim() || null,
        marked_by: viewer.id,
      })
      .eq("id", input.id)
      .select(SELECT_COLUMNS)
      .maybeSingle();

    if (error) {
      if (isMissingTableError(error.message)) {
        return { success: false, error: ATTENDANCE_TABLE_MISSING_ERROR };
      }
      return { success: false, error: getErrorMessage(error, "Could not update attendance.") };
    }
    if (!data) {
      return { success: false, error: "This attendance row no longer exists — it may have been deleted." };
    }

    revalidatePath("/dashboard/attendance");
    return { success: true, data: toAttendanceRow(data as AttendanceDbRow) };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not update attendance.") };
  }
}

/**
 * DELETES a row entirely — admin/manager only. The RLS policies grant delete
 * to managers alone (employees can insert their own check-in but never erase
 * it), so this is the only way a day is removed from the register.
 */
export async function deleteAttendance(id: string): Promise<AttendanceResult<{ id: string }>> {
  try {
    const viewer = await getViewerContext();
    if (!viewer) return { success: false, error: "Please sign in first." };
    if (!isManager(viewer.role)) {
      return { success: false, error: "Only an admin or manager can delete attendance." };
    }
    if (!id) return { success: false, error: "That attendance row no longer exists." };

    const { error } = await viewer.supabase.from("attendance").delete().eq("id", id);

    if (error) {
      if (isMissingTableError(error.message)) {
        return { success: false, error: ATTENDANCE_TABLE_MISSING_ERROR };
      }
      return { success: false, error: getErrorMessage(error, "Could not delete attendance.") };
    }

    revalidatePath("/dashboard/attendance");
    return { success: true, data: { id } };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not delete attendance.") };
  }
}

export interface EmployeeLeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  startDate: string;
  endDate: string;
  leaveType: "Casual" | "Sick" | "Paid" | "Unpaid" | "Other";
  duration: "full_day" | "half_day";
  reason: string;
  status: "Pending" | "Approved" | "Rejected";
  createdAt: string;
  reviewedAt: string | null;
  reviewNote: string;
}

interface EmployeeLeaveRequestDbRow {
  id: string;
  employee_id: string;
  start_date: string;
  end_date: string;
  leave_type: EmployeeLeaveRequest["leaveType"];
  duration: EmployeeLeaveRequest["duration"];
  reason: string | null;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  review_note: string | null;
  employee: { name: string | null } | { name: string | null }[] | null;
}

const LEAVE_REQUEST_SELECT =
  "id, employee_id, start_date, end_date, leave_type, duration, reason, status, created_at, reviewed_at, review_note, employee:profiles!employee_leave_requests_employee_id_fkey(name)";

function toEmployeeLeaveRequest(row: EmployeeLeaveRequestDbRow): EmployeeLeaveRequest {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: joinedName(row.employee),
    startDate: String(row.start_date),
    endDate: String(row.end_date),
    leaveType: row.leave_type,
    duration: row.duration,
    reason: row.reason ?? "",
    status: row.status === "Approved" || row.status === "Rejected" ? row.status : "Pending",
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note ?? "",
  };
}

/** Employees see their own requests; admins and managers can review the team queue. */
export async function getEmployeeLeaveRequests(): Promise<AttendanceResult<EmployeeLeaveRequest[]>> {
  try {
    const viewer = await getViewerContext();
    if (!viewer) return { success: false, error: "Please sign in first." };
    let query = viewer.supabase
      .from("employee_leave_requests")
      .select(LEAVE_REQUEST_SELECT)
      .order("created_at", { ascending: false })
      .limit(100);
    if (!isManager(viewer.role)) query = query.eq("employee_id", viewer.id);
    const { data, error } = await query;
    if (error) return { success: false, error: getErrorMessage(error, "Could not load leave requests.") };
    return {
      success: true,
      data: ((data ?? []) as unknown as EmployeeLeaveRequestDbRow[]).map(toEmployeeLeaveRequest),
    };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not load leave requests.") };
  }
}

/** Employees submit a dated leave request; only an admin can approve or reject it. */
export async function createEmployeeLeaveRequest(input: {
  startDate: string;
  endDate: string;
  leaveType: EmployeeLeaveRequest["leaveType"];
  duration: EmployeeLeaveRequest["duration"];
  reason?: string;
}): Promise<AttendanceResult<EmployeeLeaveRequest>> {
  try {
    const viewer = await getViewerContext();
    if (!viewer) return { success: false, error: "Please sign in first." };
    if (isAdmin(viewer.role)) return { success: false, error: "Admins do not submit employee leave requests." };
    if (!isValidIsoDate(input.startDate) || !isValidIsoDate(input.endDate)) {
      return { success: false, error: "Choose valid leave dates." };
    }
    if (input.startDate < clinicDate()) {
      return { success: false, error: "Leave requests must start today or later." };
    }
    if (input.endDate < input.startDate) return { success: false, error: "The end date must be on or after the start date." };
    if (input.duration !== "full_day" && input.duration !== "half_day") {
      return { success: false, error: "Choose full-day or half-day leave." };
    }
    if (input.duration === "half_day" && input.startDate !== input.endDate) {
      return { success: false, error: "Half-day leave must be for a single date." };
    }
    const leaveTypes: EmployeeLeaveRequest["leaveType"][] = ["Casual", "Sick", "Paid", "Unpaid", "Other"];
    if (!leaveTypes.includes(input.leaveType)) return { success: false, error: "Choose a valid leave type." };
    const reason = input.reason?.trim() ?? "";
    if (reason.length > 1000) return { success: false, error: "Reason must be 1,000 characters or fewer." };

    const { data, error } = await viewer.supabase
      .from("employee_leave_requests")
      .insert({
        employee_id: viewer.id,
        start_date: input.startDate,
        end_date: input.endDate,
        leave_type: input.leaveType,
        duration: input.duration,
        reason,
      })
      .select(LEAVE_REQUEST_SELECT)
      .single();
    if (error) return { success: false, error: getErrorMessage(error, "Could not submit the leave request.") };
    revalidatePath("/dashboard/attendance");
    return { success: true, data: toEmployeeLeaveRequest(data as unknown as EmployeeLeaveRequestDbRow) };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not submit the leave request.") };
  }
}

export async function reviewEmployeeLeaveRequest(input: {
  id: string;
  approved: boolean;
  reviewNote?: string;
}): Promise<AttendanceResult<{ id: string; status: "Approved" | "Rejected" }>> {
  try {
    const viewer = await getViewerContext();
    if (!viewer) return { success: false, error: "Please sign in first." };
    if (!isAdmin(viewer.role)) return { success: false, error: "Only an admin can review leave requests." };
    if (!input.id.trim()) return { success: false, error: "Choose a leave request." };
    if (typeof input.approved !== "boolean") return { success: false, error: "Choose whether to approve or reject the request." };
    const reviewNote = input.reviewNote?.trim() ?? "";
    if (reviewNote.length > 1000) return { success: false, error: "Review note must be 1,000 characters or fewer." };

    const { data, error } = await viewer.supabase
      .from("employee_leave_requests")
      .update({
        status: input.approved ? "Approved" : "Rejected",
        reviewed_by: viewer.id,
        reviewed_at: new Date().toISOString(),
        review_note: reviewNote,
      })
      .eq("id", input.id)
      .eq("status", "Pending")
      .select("id")
      .maybeSingle();
    if (error) return { success: false, error: getErrorMessage(error, "Could not review the leave request.") };
    if (!data) return { success: false, error: "This leave request was already reviewed or no longer exists." };
    revalidatePath("/dashboard/attendance");
    return { success: true, data: { id: input.id, status: input.approved ? "Approved" : "Rejected" } };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not review the leave request.") };
  }
}

/** Sets or moves one employee's chosen off date in an ISO week. */
export async function setEmployeeWeeklyOff(input: {
  employeeId: string;
  date: string;
  note?: string;
}): Promise<AttendanceResult<AttendanceWeeklyOff>> {
  try {
    const viewer = await getViewerContext();
    if (!viewer) return { success: false, error: "Please sign in first." };
    if (!isAdmin(viewer.role)) return { success: false, error: "Only an admin can set weekly offs." };
    if (!input.employeeId) return { success: false, error: "Choose an employee." };
    if (!isValidIsoDate(input.date)) return { success: false, error: "Choose a valid weekly off date." };
    const weekStartDate = attendanceWeekStart(input.date);
    if (!weekStartDate) return { success: false, error: "Choose a valid weekly off date." };
    const note = input.note?.trim() ?? "";
    if (note.length > 500) return { success: false, error: "Note must be 500 characters or fewer." };

    const { data: employee, error: employeeError } = await viewer.supabase
      .from("profiles")
      .select("id")
      .eq("id", input.employeeId)
      .eq("role", "employee")
      .maybeSingle();
    if (employeeError) return { success: false, error: employeeError.message };
    if (!employee) return { success: false, error: "Choose an active employee." };

    const { data, error } = await viewer.supabase
      .from("employee_weekly_offs")
      .upsert({
        employee_id: input.employeeId,
        week_start_date: weekStartDate,
        off_date: input.date,
        note,
        created_by: viewer.id,
        updated_by: viewer.id,
      }, { onConflict: "employee_id,week_start_date" })
      .select(WEEKLY_OFF_SELECT)
      .single();
    if (error) return { success: false, error: getErrorMessage(error, "Could not save the weekly off.") };
    revalidatePath("/dashboard/attendance");
    return { success: true, data: toWeeklyOff(data as unknown as WeeklyOffDbRow) };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not save the weekly off.") };
  }
}

export async function removeEmployeeWeeklyOff(id: string): Promise<AttendanceResult<{ id: string }>> {
  try {
    const viewer = await getViewerContext();
    if (!viewer) return { success: false, error: "Please sign in first." };
    if (!isAdmin(viewer.role)) return { success: false, error: "Only an admin can remove weekly offs." };
    if (!id.trim()) return { success: false, error: "Choose a weekly off to remove." };
    const { error } = await viewer.supabase.from("employee_weekly_offs").delete().eq("id", id);
    if (error) return { success: false, error: getErrorMessage(error, "Could not remove the weekly off.") };
    revalidatePath("/dashboard/attendance");
    return { success: true, data: { id } };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not remove the weekly off.") };
  }
}
