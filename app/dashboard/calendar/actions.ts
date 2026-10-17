"use server";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/app/actions/leads";
import { calendarAgendaWindow } from "@/lib/calendar-entry";
import { buildMonthCells } from "./month-grid";
import { isCurrentStatusAppointment, type AppointmentKind } from "@/lib/appointments";
export type { AppointmentKind } from "@/lib/appointments";
export type CalendarResult<T> =
  | { success: true; data: T; error?: undefined }
  | { success: false; data?: undefined; error: string };
export interface CalendarAppointment {
  leadId: string;
  leadName: string;
  phone: string;
  leadStatus: string;
  kind: AppointmentKind;
  kindLabel: string;
  date: string;
  past: boolean;
  agent: string;
  appointmentId: string;
  appointmentStatus: string;
  time: string;
  notes: string;
  updatedAt: string;
}
export interface CalendarDay {
  iso: string;
  day: number;
  isCurrentMonth: boolean;
  reminders: CalendarAppointment[];
}
export interface MonthDays {
  month: string;
  days: CalendarDay[];
  upcoming: CalendarAppointment[];
  past: CalendarAppointment[];
  warning?: string;
}
interface AppointmentRow {
  id: string;
  kind: AppointmentKind;
  status: string;
  starts_on: string;
  starts_at: string | null;
  notes: string;
  updated_at: string;
  legacy_column: string | null;
  lead: {
    id: string;
    name: string;
    phone: string | null;
    status: string;
    assigned_to: string | null;
  };
}
export async function getMonthDays(
  month?: string,
  includeUpcoming = false,
): Promise<CalendarResult<MonthDays>> {
  try {
    const viewer = await getViewer();
    if (!viewer.success || !viewer.data)
      return { success: false, error: "Sign in to view appointments." };
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
    }).format(new Date());
    const target = /^\d{4}-(0[1-9]|1[0-2])$/.test(month ?? "")
        ? month!
        : today.slice(0, 7),
      cells = buildMonthCells(target);
    const from = cells[0].iso,
      to = cells.at(-1)!.iso,
      { pastStart, upcomingEnd } = calendarAgendaWindow(today);
    const supabase = await createClient(),
      rows: AppointmentRow[] = [];
    for (let offset = 0; ; offset += 500) {
      let q = supabase
        .from("crm_appointments")
        .select(
          "id,kind,status,starts_on,starts_at,notes,updated_at,legacy_column,lead:leads!inner(id,name,phone,status,assigned_to)",
        )
        .or(
          `and(starts_on.gte.${from},starts_on.lte.${to})${includeUpcoming ? `,and(starts_on.gte.${pastStart},starts_on.lte.${upcomingEnd})` : ""}`,
        )
        .order("starts_on")
        .order("id")
        .range(offset, offset + 499);
      if (viewer.data.role === "employee")
        q = q.ilike(
          "lead.assigned_to",
          viewer.data.name.replace(/[\\%_]/g, "\\$&"),
        );
      const { data, error } = await q;
      if (error)
        return {
          success: false,
          error: "Appointments could not be loaded. Please retry.",
        };
      rows.push(...((data ?? []) as unknown as AppointmentRow[]));
      if (!data || data.length < 500) break;
    }
    const entries: CalendarAppointment[] = rows
      .filter((a) => isCurrentStatusAppointment(a.lead.status, a.legacy_column))
      .map((a) => ({
        appointmentId: a.id,
        leadId: a.lead.id,
        leadName: a.lead.name,
        phone: a.lead.phone || "-",
        leadStatus: a.lead.status,
        kind: a.kind,
        kindLabel: `${a.kind === "ipdDone" ? "IPD / Surgery" : "OPD"} · ${a.status.replace("_", " ")}`,
        date: a.starts_on,
        past: a.starts_on < today,
        agent: a.lead.assigned_to || "-",
        appointmentStatus: a.status,
        time: a.starts_at?.slice(0, 5) || "",
        notes: a.notes,
        updatedAt: a.updated_at,
      }));
    const byDay = new Map<string, CalendarAppointment[]>();
    for (const entry of entries) {
      if (entry.date < from || entry.date > to) continue;
      byDay.set(entry.date, [...(byDay.get(entry.date) ?? []), entry]);
    }
    return {
      success: true,
      data: {
        month: target,
        days: cells.map((cell) => ({
          ...cell,
          reminders: byDay.get(cell.iso) ?? [],
        })),
        upcoming: entries.filter(
          (e) => e.date >= today && e.date <= upcomingEnd,
        ),
        past: entries
          .filter((e) => e.date < today && e.date >= pastStart)
          .sort(
            (a, b) =>
              b.date.localeCompare(a.date) || a.time.localeCompare(b.time),
          ),
      },
    };
  } catch {
    return { success: false, error: "Calendar could not be loaded." };
  }
}
export async function changeAppointmentStatus(
  id: string,
  status: string,
): Promise<CalendarResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_change_appointment_status", {
    p_id: id,
    p_status: status,
  });
  if (error) return { success: false, error: error.message };
  const { revalidatePath } = await import("next/cache");
  revalidatePath("/dashboard", "layout");
  return { success: true, data: null };
}
