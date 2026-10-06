"use server";

import { createClient } from "@/lib/supabase/server";
import {
  appointmentForStatus,
  normaliseAppointmentDate,
  type AppointmentField,
  type AppointmentKind,
} from "@/lib/appointments";

/**
 * The three appointment columns, in the order a patient's journey happens:
 * booked → OPD → surgery.
 *
 * Kept as a local (not exported) because a "use server" module may only export
 * async functions. The ORDER and the COLUMN NAMES come from the pure module,
 * so this list can never drift from what `appointmentForStatus` writes.
 */
const APPOINTMENT_FIELDS: readonly AppointmentField[] = [
  appointmentForStatus("OPD Booked"),
  appointmentForStatus("OPD Done"),
  appointmentForStatus("IPD Done"),
].filter((field): field is AppointmentField => field !== null);
export type CalendarResult<T> =
  | { success: true; data: T; error?: undefined }
  | { success: false; data?: undefined; error: string };

/**
 * What an appointment on the calendar IS — a booked OPD, a done OPD, or an IPD.
 * Re-exported so plan-calendar.tsx (a client component) can name the kind
 * without importing from lib/appointments.ts directly; a "use server" module
 * may only export async functions, but TYPE exports are erased at compile time
 * and are allowed.
 */
export type { AppointmentKind } from "@/lib/appointments";

export interface CalendarAppointment {
  leadId: string;
  leadName: string;
  phone: string;
  leadStatus: string;
  /** Which of the three dates this entry is for (see lib/appointments.ts). */
  kind: AppointmentKind;
  /** Human label for the day panel: "Booked", "OPD", "IPD / Surgery". */
  kindLabel: string;
  /** yyyy-mm-dd this appointment falls on. */
  date: string;
  /** Past dates are flagged so the day panel can sort them first. */
  past: boolean;
  /** Owning agent. */
  agent: string;
}

/**
 * Short label shown on the calendar chip for each kind of appointment.
 *
 * The label map lives HERE rather than in lib/appointments.ts because this is a
 * "use server" module: Next forbids it from exporting anything but async
 * functions, so a plain constant has to stay out of it. The columns themselves
 * are imported from the pure module instead.
 */
const APPOINTMENT_KIND_LABELS: Record<AppointmentKind, string> = {
  opdBooked: "OPD Booked",
  opdDone: "OPD Done",
  ipdDone: "IPD / Surgery",
};

export interface CalendarDay {
  iso: string;
  day: number;
  isCurrentMonth: boolean;
  reminders: CalendarAppointment[];
}

export interface MonthDays {
  month: string;
  days: CalendarDay[];
  warning?: string;
  /** All appointments from today onwards, soonest first — the "upcoming" list. */
  upcoming: CalendarAppointment[];
}

const APPOINTMENT_COLUMNS_MISSING_WARNING =
  "Appointment dates are unavailable — run supabase-master-data-migration.sql in the Supabase SQL editor.";

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function toIsoDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function isMissingAppointmentColumnsError(
  error: { code?: string | null; message?: string | null },
): boolean {
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    /opd_booked_date|opd_done_date|ipd_done_date/i.test(error.message ?? "")
  );
}

interface LeadAppointmentRow {
  id: string;
  name: string | null;
  phone: string | null;
  status: string | null;
  assigned_to: string | null;
  /** Nullable columns — added by supabase-master-data-migration.sql. */
  opd_booked_date: string | null;
  opd_done_date: string | null;
  ipd_done_date: string | null;
}

/**
 * Splits one lead into the calendar entries its dates produce.
 *
 * A lead that has both an OPD booking and an IPD surgery yields TWO entries —
 * that is deliberate. Collapsing them onto one date would mean choosing which
 * date "wins", and the clinic needs to see the patient on the day they are
 * actually expected to arrive.
 */
function toCalendarAppointments(row: LeadAppointmentRow, today: string): CalendarAppointment[] {
  const agent = (row.assigned_to ?? "").trim() || "-";
  const status = (row.status ?? "").trim() || "-";

  const entries: CalendarAppointment[] = [];
  for (const field of APPOINTMENT_FIELDS) {
    const iso = toCalendarDate(normaliseAppointmentDate(row[field.column]));
    if (!iso) continue;
    entries.push({
      leadId: row.id,
      leadName: (row.name ?? "").trim() || "Unnamed lead",
      phone: (row.phone ?? "").trim() || "-",
      leadStatus: status,
      kind: field.kind,
      kindLabel: APPOINTMENT_KIND_LABELS[field.kind],
      date: iso,
      past: iso < today,
      agent,
    });
  }
  // Soonest first so a day panel reads booking → OPD → surgery.
  return entries.sort((a, b) => a.date.localeCompare(b.date));
}

/** Signed-in viewer and role, or null. */
async function getCalendarViewer(): Promise<{
  name: string;
  role: "admin" | "manager" | "employee";
} | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("name,role")
    .eq("id", user.id)
    .single();
  const name =
    typeof profile?.name === "string" && profile.name.trim() ? profile.name.trim() : "Agent";
  const role =
    profile?.role === "admin" || profile?.role === "manager" ? profile.role : "employee";
  return { name, role };
}

/** yyyy-mm-dd for a stored appointment date. */
function toCalendarDate(value: string | null): string {
  if (!value || value === "-") return "";
  const text = value.trim();
  const dayFirst = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(text);
  if (dayFirst) {
    const year = dayFirst[3].length === 2 ? Number(`20${dayFirst[3]}`) : Number(dayFirst[3]);
    const month = Number(dayFirst[2]);
    const day = Number(dayFirst[1]);
    if (!year || !month || !day) return "";
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return toIsoDate(parsed);
}

/** Month cells for `getMonthDays` — the real math lives in ./month-grid (Next
 *  forbids non-async exports from a "use server" file, so this file must not
 *  define or export it). */
async function monthCells(
  month: string,
): Promise<{ iso: string; day: number; isCurrentMonth: boolean }[]> {
  const grid = await import("./month-grid");
  return grid.buildMonthCells(month);
}

/**
 * One month of the OPD/IPD appointment calendar. Admins and managers see the
 * team schedule; employees see appointments assigned to their profile name.
 */
export async function getMonthDays(month?: string): Promise<CalendarResult<MonthDays>> {
  try {
    const viewer = await getCalendarViewer();
    if (!viewer) return { success: false, error: "Sign in to open your calendar." };

    const now = new Date();
    const target = /^\d{4}-\d{2}$/.test(month ?? "") ? month! : toIsoDate(now).slice(0, 7);
    const cells = await monthCells(target);
    const from = cells[0]!.iso;
    const to = cells[cells.length - 1]!.iso;
    const today = toIsoDate(now);

    const supabase = await createClient();

    const viewerName = viewer.name.trim().toLowerCase();
    const isTeamView = viewer.role === "admin" || viewer.role === "manager";

    // Appointments read live off the three OPD/IPD columns on `leads` — NOT from
    // leads.follow_up_date. Follow-up calls are handled by the Leads page
    // filters; this calendar is specifically the clinic's OPD/IPD schedule.
    //
    // The three columns come back in ONE query and then spread into up to three
    // calendar entries per lead: a patient booked for OPD and later admitted
    // for IPD appears on BOTH days, which is the whole point of storing three
    // dates instead of one.
    //
    // `assigned_to` stores a display name rather than an auth uid, so employee
    // appointments are filtered against the signed-in profile after fetching.
    const { data: leadRows, error: leadsError } = await supabase
      .from("leads")
      .select("id,name,phone,status,assigned_to,opd_booked_date,opd_done_date,ipd_done_date")
      .or("opd_booked_date.not.is.null,opd_done_date.not.is.null,ipd_done_date.not.is.null")
      .limit(500);
    let warning: string | undefined;
    if (leadsError) {
      if (isMissingAppointmentColumnsError(leadsError)) {
        warning = APPOINTMENT_COLUMNS_MISSING_WARNING;
      } else {
        return { success: false, error: leadsError.message };
      }
    }

    const byDay = new Map<string, CalendarAppointment[]>();
    const upcoming: CalendarAppointment[] = [];
    for (const row of (leadRows ?? []) as LeadAppointmentRow[]) {
      if (!isTeamView && (row.assigned_to ?? "").trim().toLowerCase() !== viewerName) continue;
      for (const entry of toCalendarAppointments(row, today)) {
        if (entry.date < from || entry.date > to) continue;
        const bucket = byDay.get(entry.date) ?? [];
        bucket.push(entry);
        byDay.set(entry.date, bucket);
        if (entry.date >= today) upcoming.push(entry);
      }
    }
    // Soonest first; same-day entries keep a stable, human (alphabetical) order.
    upcoming.sort((a, b) =>
      a.date === b.date ? a.leadName.localeCompare(b.leadName) : a.date.localeCompare(b.date),
    );

    const days: CalendarDay[] = cells.map((cell) => ({
      ...cell,
      reminders: byDay.get(cell.iso) ?? [],
    }));
    // `upcoming` is built in the query loop above and spans every day of the
    // month from today forward, so it survives a month change without a second
    // round trip.
    return { success: true, data: { month: target, days, upcoming, warning } };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Unable to load the calendar.") };
  }
}
