"use server";

import { revalidatePath } from "next/cache";

import {
  attendanceMonthRange,
  clinicDate,
  formatClock,
  isAttendanceStatus,
  normaliseStatus,
  sortByCheckIn,
  summariseMonth,
  type AttendanceRow,
  type AttendanceStatus,
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
): Promise<AttendanceResult<{ month: string; rows: AttendanceRow[] }>> {
  try {
    const viewer = await getViewerContext();
    if (!viewer) return { success: false, error: "Please sign in first." };
    const range = attendanceMonthRange(month);
    if (!range) return { success: false, error: "Month must be a valid YYYY-MM value, such as 2026-09." };

    const { data, error } = await viewer.supabase
      .from("attendance")
      .select(SELECT_COLUMNS)
      .eq("employee_id", viewer.id)
      .gte("attendance_date", range.start)
      .lt("attendance_date", range.endExclusive)
      .order("attendance_date", { ascending: false });

    if (error) {
      if (isMissingTableError(error.message)) {
        return { success: false, error: ATTENDANCE_TABLE_MISSING_ERROR };
      }
      return { success: false, error: getErrorMessage(error, "Could not load attendance.") };
    }

    const rows = ((data ?? []) as AttendanceDbRow[]).map(toAttendanceRow);
    return { success: true, data: { month, rows: sortByCheckIn(rows) } };
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

    const { data, error } = await viewer.supabase
      .from("attendance")
      .select(SELECT_COLUMNS)
      .gte("attendance_date", range.start)
      .lt("attendance_date", range.endExclusive)
      .order("attendance_date", { ascending: false })
      .order("check_in_at", { ascending: true, nullsFirst: false });

    if (error) {
      if (isMissingTableError(error.message)) {
        return { success: false, error: ATTENDANCE_TABLE_MISSING_ERROR };
      }
      return { success: false, error: getErrorMessage(error, "Could not load attendance.") };
    }

    const rows = ((data ?? []) as AttendanceDbRow[]).map(toAttendanceRow);
    return { success: true, data: { month, rows, summary: summariseMonth(rows) } };
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