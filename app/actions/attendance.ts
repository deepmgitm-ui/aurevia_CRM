"use server";

import { revalidatePath } from "next/cache";

import {
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

/** Shown instead of crashing the calendar when the migration isn't applied. */
const ATTENDANCE_TABLE_MISSING_ERROR =
  "Attendance abhi start nahi ho sakta — pehle supabase-hr-migration.sql ko Supabase SQL editor me chalao (attendance table + check_in_at columns).";

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

const MONTH_PATTERN = /^\d{4}-\d{2}$/;
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
export async function markMyAttendance(): Promise<AttendanceResult<AttendanceRow | null>> {
  try {
    const viewer = await getViewerContext();
    if (!viewer) return { success: true, data: null };

    const today = clinicDate();
    const { error } = await viewer.supabase.from("attendance").upsert(
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
      return { success: false, error: getErrorMessage(error, "Attendance mark nahi hua.") };
    }

    const { data } = await viewer.supabase
      .from("attendance")
      .select(SELECT_COLUMNS)
      .eq("employee_id", viewer.id)
      .eq("attendance_date", today)
      .maybeSingle();

    return { success: true, data: data ? toAttendanceRow(data as AttendanceDbRow) : null };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Attendance mark nahi hua.") };
  }
}

/** The signed-in employee's own register for one month. */
export async function getMyAttendance(
  month: string,
): Promise<AttendanceResult<{ month: string; rows: AttendanceRow[] }>> {
  try {
    const viewer = await getViewerContext();
    if (!viewer) return { success: false, error: "Pehle login karo." };
    if (!MONTH_PATTERN.test(month)) {
      return { success: false, error: "Month 2026-09 jaisa hona chahiye." };
    }

    const { data, error } = await viewer.supabase
      .from("attendance")
      .select(SELECT_COLUMNS)
      .eq("employee_id", viewer.id)
      .gte("attendance_date", `${month}-01`)
      .lte("attendance_date", `${month}-31`)
      .order("attendance_date", { ascending: false });

    if (error) {
      if (isMissingTableError(error.message)) {
        return { success: false, error: ATTENDANCE_TABLE_MISSING_ERROR };
      }
      return { success: false, error: getErrorMessage(error, "Attendance load nahi hua.") };
    }

    const rows = ((data ?? []) as AttendanceDbRow[]).map(toAttendanceRow);
    return { success: true, data: { month, rows: sortByCheckIn(rows) } };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Attendance load nahi hua.") };
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
    if (!viewer) return { success: false, error: "Pehle login karo." };
    if (!isManager(viewer.role)) {
      return { success: false, error: "Team attendance sirf admin/manager dekh sakta hai." };
    }
    if (!MONTH_PATTERN.test(month)) {
      return { success: false, error: "Month 2026-09 jaisa hona chahiye." };
    }

    const { data, error } = await viewer.supabase
      .from("attendance")
      .select(SELECT_COLUMNS)
      .gte("attendance_date", `${month}-01`)
      .lte("attendance_date", `${month}-31`)
      .order("attendance_date", { ascending: false })
      .order("check_in_at", { ascending: true, nullsFirst: false });

    if (error) {
      if (isMissingTableError(error.message)) {
        return { success: false, error: ATTENDANCE_TABLE_MISSING_ERROR };
      }
      return { success: false, error: getErrorMessage(error, "Attendance load nahi hua.") };
    }

    const rows = ((data ?? []) as AttendanceDbRow[]).map(toAttendanceRow);
    return { success: true, data: { month, rows, summary: summariseMonth(rows) } };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Attendance load nahi hua.") };
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
    if (!viewer) return { success: false, error: "Pehle login karo." };
    if (!isManager(viewer.role)) {
      return { success: false, error: "Attendance sirf admin/manager change kar sakta hai." };
    }
    if (!input.employeeId) return { success: false, error: "Employee chuno." };
    if (!DATE_PATTERN.test(input.date)) {
      return { success: false, error: "Date 2026-09-30 jaisi honi chahiye." };
    }
    if (!isAttendanceStatus(input.status)) {
      return { success: false, error: "Status Present / Absent / Half-Day me se ek chuno." };
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
      return { success: false, error: getErrorMessage(error, "Attendance save nahi hua.") };
    }

    revalidatePath("/dashboard/attendance");
    return { success: true, data: toAttendanceRow(data as AttendanceDbRow) };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Attendance save nahi hua.") };
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
    if (!viewer) return { success: false, error: "Pehle login karo." };
    if (!isManager(viewer.role)) {
      return { success: false, error: "Attendance sirf admin/manager change kar sakta hai." };
    }
    if (!input.id) return { success: false, error: "Attendance row nahi mili." };
    if (!isAttendanceStatus(input.status)) {
      return { success: false, error: "Status Present / Absent / Half-Day me se ek chuno." };
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
      return { success: false, error: getErrorMessage(error, "Attendance update nahi hua.") };
    }
    if (!data) {
      return { success: false, error: "Ye attendance row ab nahi hai (shayad delete ho gayi)." };
    }

    revalidatePath("/dashboard/attendance");
    return { success: true, data: toAttendanceRow(data as AttendanceDbRow) };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Attendance update nahi hua.") };
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
    if (!viewer) return { success: false, error: "Pehle login karo." };
    if (!isManager(viewer.role)) {
      return { success: false, error: "Attendance sirf admin/manager delete kar sakta hai." };
    }
    if (!id) return { success: false, error: "Attendance row nahi mili." };

    const { error } = await viewer.supabase.from("attendance").delete().eq("id", id);

    if (error) {
      if (isMissingTableError(error.message)) {
        return { success: false, error: ATTENDANCE_TABLE_MISSING_ERROR };
      }
      return { success: false, error: getErrorMessage(error, "Attendance delete nahi hua.") };
    }

    revalidatePath("/dashboard/attendance");
    return { success: true, data: { id } };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Attendance delete nahi hua.") };
  }
}