"use server";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/app/actions/leads";
import { calendarAgendaWindow } from "@/lib/calendar-entry";
import { buildMonthCells } from "./month-grid";
import { appointmentForStatus, normaliseAppointmentDate, selectCurrentStatusAppointments, type AppointmentKind } from "@/lib/appointments";
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
  bookedBy: string | null;
  completedBy: string | null;
  appointmentId: string | null;
  dateSource: "appointment" | "status-change" | "record-created";
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
  undated: CalendarAppointment[];
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
  created_by: string | null;
  performed_by: string | null;
  lead: {
    id: string;
    name: string;
    phone: string | null;
    status: string;
    assigned_to: string | null;
  };
}
interface UndatedBookingLead {
  id: string;
  name: string;
  phone: string | null;
  status: string;
  assigned_to: string | null;
  opd_booked_date: string | null;
  ipd_done_date: string | null;
  created_at: string;
}
interface StatusChangeRow {
  lead_id: string;
  user_id: string | null;
  created_at: string;
  description: string;
}
export async function getMonthDays(
  month?: string,
  includeUpcoming = false,
): Promise<CalendarResult<MonthDays>> {
  try {
    const viewer = await getViewer();
    if (!viewer.success || !viewer.data)
      return { success: false, error: "Sign in to view appointments." };
    const viewerData = viewer.data;
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
          "id,kind,status,starts_on,starts_at,notes,updated_at,legacy_column,created_by,performed_by,lead:leads!inner(id,name,phone,status,assigned_to)",
        )
        .or(
          `and(starts_on.gte.${from},starts_on.lte.${to})${includeUpcoming ? `,and(starts_on.gte.${pastStart},starts_on.lte.${upcomingEnd})` : ""}`,
        )
        .order("starts_on")
        .order("id")
        .range(offset, offset + 499);
      if (viewerData.role === "employee")
        q = q.ilike(
          "lead.assigned_to",
          viewerData.name.replace(/[\\%_]/g, "\\$&"),
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
    const currentAppointments = selectCurrentStatusAppointments(rows);
    const currentAppointmentLeadIds = new Set(currentAppointments.map((appointment) => appointment.lead.id));
    const undatedLeads: UndatedBookingLead[] = [];
    for (let offset = 0; ; offset += 500) {
      let q = supabase.from("leads")
        .select("id,name,phone,status,assigned_to,opd_booked_date,ipd_done_date,created_at")
        .in("status", ["OPD Booked", "Consultation Booked", "IPD Booked", "Surgery Scheduled"])
        .or("opd_booked_date.is.null,opd_booked_date.eq.,opd_booked_date.eq.-,opd_booked_date.eq.--,ipd_done_date.is.null,ipd_done_date.eq.,ipd_done_date.eq.-,ipd_done_date.eq.--")
        .order("created_at", { ascending: false })
        .range(offset, offset + 499);
      if (viewerData.role === "employee") {
        q = q.ilike("assigned_to", viewerData.name.replace(/[\\%_]/g, "\\$&"));
      }
      const { data, error } = await q;
      if (error) return { success: false, error: "Date-needed OPD/IPD bookings could not be loaded. Please retry." };
      undatedLeads.push(...((data ?? []) as UndatedBookingLead[]));
      if (!data || data.length < 500) break;
    }
    const needsDate = undatedLeads.filter((lead) => {
      const field = appointmentForStatus(lead.status);
      const date = field?.kind === "ipdDone" ? lead.ipd_done_date : lead.opd_booked_date;
      return Boolean(field) && !normaliseAppointmentDate(date) && !currentAppointmentLeadIds.has(lead.id);
    });
    const statusChanges = new Map<string, StatusChangeRow>();
    for (let offset = 0; offset < needsDate.length; offset += 100) {
      const leadIds = needsDate.slice(offset, offset + 100).map((lead) => lead.id);
      for (let rowOffset = 0; ; rowOffset += 500) {
        const { data, error } = await supabase.from("lead_activities")
          .select("lead_id,user_id,created_at,description")
          .in("lead_id", leadIds)
          .eq("action_type", "Status changed")
          .or("description.like.% → OPD Booked,description.like.% → Consultation Booked,description.like.% → IPD Booked,description.like.% → Surgery Scheduled")
          .order("created_at", { ascending: false })
          .range(rowOffset, rowOffset + 499);
        if (error) return { success: false, error: "OPD/IPD booking history could not be loaded. Please retry." };
        for (const row of (data ?? []) as StatusChangeRow[]) {
          if (!statusChanges.has(row.lead_id)) statusChanges.set(row.lead_id, row);
        }
        if (!data || data.length < 500) break;
      }
    }
    const actorIds = viewerData.role === "admin"
      ? [...new Set([
          ...currentAppointments.flatMap((appointment) => [appointment.created_by, appointment.performed_by]),
          ...[...statusChanges.values()].map((change) => change.user_id),
        ].filter((id): id is string => Boolean(id)))]
      : [];
    const actorNames = new Map<string, string>();
    for (let offset = 0; offset < actorIds.length; offset += 500) {
      const { data: actors, error } = await supabase.from("profiles")
        .select("id,name")
        .in("id", actorIds.slice(offset, offset + 500));
      if (error) return { success: false, error: "Appointment booking names could not be loaded. Please retry." };
      for (const actor of actors ?? []) actorNames.set(actor.id, actor.name?.trim() || "");
    }
    const entries: CalendarAppointment[] = currentAppointments
      .map((a) => ({
        appointmentId: a.id,
        leadId: a.lead.id,
        leadName: a.lead.name,
        phone: a.lead.phone || "-",
        leadStatus: a.lead.status,
        kind: a.kind,
        kindLabel: `${a.kind === "ipdDone" ? "IPD / Surgery" : "OPD"} · ${a.status.replace("_", " ")}`,
        date: a.starts_on,
        dateSource: "appointment" as const,
        past: a.starts_on < today,
        agent: a.lead.assigned_to || "-",
        bookedBy: viewerData.role === "admin" ? actorNames.get(a.created_by ?? "") || null : null,
        completedBy: viewerData.role === "admin" ? actorNames.get(a.performed_by ?? "") || null : null,
        appointmentStatus: a.status,
        time: a.starts_at?.slice(0, 5) || "",
        notes: a.notes,
        updatedAt: a.updated_at,
      }));
    const undated: CalendarAppointment[] = needsDate.map((lead) => {
      const change = statusChanges.get(lead.id);
      const timestamp = change?.created_at ?? lead.created_at;
      const isIpd = appointmentForStatus(lead.status)?.kind === "ipdDone";
      return {
        appointmentId: null,
        leadId: lead.id,
        leadName: lead.name,
        phone: lead.phone || "-",
        leadStatus: lead.status,
        kind: isIpd ? "ipdDone" : "opdBooked",
        kindLabel: `${isIpd ? "IPD" : "OPD"} Booked · date needed`,
        date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(timestamp)),
        dateSource: change ? "status-change" : "record-created",
        past: false,
        agent: lead.assigned_to || "-",
        bookedBy: viewerData.role === "admin" ? actorNames.get(change?.user_id ?? "") || null : null,
        completedBy: null,
        appointmentStatus: "booked",
        time: "",
        notes: "",
        updatedAt: timestamp,
      };
    });
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
        undated,
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
