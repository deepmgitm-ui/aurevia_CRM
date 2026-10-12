import { isWorkDate } from "./daily-work.ts";

export const CALENDAR_ENTRY_TYPES = {
  opdBooked: { column: "opd_booked_date", status: "OPD Booked", label: "OPD booking" },
  opdDone: { column: "opd_done_date", status: "OPD Done", label: "OPD completed" },
  ipdDone: { column: "ipd_done_date", status: "IPD Done", label: "IPD / Surgery" },
} as const;
export type CalendarEntryKind = keyof typeof CALENDAR_ENTRY_TYPES;
export interface CalendarEntryInput {
  mode: "new" | "existing";
  leadId?: string;
  expectedUpdatedAt?: string;
  kind: CalendarEntryKind;
  date: string;
  name: string;
  phone: string;
  city: string;
  remarks: string;
  assignedTo: string;
  updateStatus: boolean;
  appointmentId?: string;
  expectedAppointmentUpdatedAt?: string;
  appointmentStatus?: string;
  time?: string;
  appointmentNotes?: string;
}

export function validateCalendarEntry(input: CalendarEntryInput): string | null {
  if (!input || !["new", "existing"].includes(input.mode)) return "Choose an existing lead or a new patient.";
  if (!Object.hasOwn(CALENDAR_ENTRY_TYPES, input.kind)) return "Choose a valid appointment type.";
  if(input.appointmentStatus && !["booked","confirmed","arrived","completed","cancelled","no_show"].includes(input.appointmentStatus)) return "Choose a valid appointment status.";
  if(input.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) return "Choose a valid appointment time.";
  if(input.appointmentNotes && input.appointmentNotes.length>5000) return "Appointment notes are too long.";
  if(input.appointmentId && !input.expectedAppointmentUpdatedAt) return "Reopen the appointment before saving.";
  if (!isWorkDate(input.date)) return "Choose a valid appointment date.";
  if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 200) return "Patient name is required (maximum 200 characters).";
  if (typeof input.phone !== "string" || typeof input.city !== "string" || typeof input.remarks !== "string" || typeof input.assignedTo !== "string" || typeof input.updateStatus !== "boolean") return "Invalid patient details.";
  const digits = input.phone.replace(/\D/g, "");
  if (input.phone.trim() && input.phone !== "-" && (digits.length < 10 || digits.length > 15)) return "Enter a valid phone number with 10–15 digits.";
  if (input.city.length > 200 || input.remarks.length > 5000) return "Patient details are too long.";
  if (input.mode === "existing" && (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.leadId ?? "") || !input.expectedUpdatedAt || Number.isNaN(Date.parse(input.expectedUpdatedAt)))) return "Select the patient again before saving.";
  return null;
}

/** Same ten-digit phone identity used by the CRM lead import and manual entry. */
export function calendarPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits ? digits.slice(-10) : "-";
}

export function calendarAgendaWindow(today: string) {
  const past = new Date(`${today}T00:00:00Z`);
  past.setUTCDate(past.getUTCDate() - 90);
  const future = new Date(`${today}T00:00:00Z`);
  future.setUTCDate(future.getUTCDate() + 89);
  return { pastStart: past.toISOString().slice(0, 10), upcomingEnd: future.toISOString().slice(0, 10) };
}
