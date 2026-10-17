// Aurevia CRM — OPD / IPD appointment dates.
//
// ONE place that answers three questions the whole app keeps asking:
//   1. Which date field does this status own? (OPD Booked → booked date, …)
//   2. Is this status a "Won"? (OPD Done / IPD Done → yes)
//   3. Which date column do I write to?
//
// Keeping all three here is what stops the Leads table, the calendar and the
// dashboard from disagreeing: they all read the SAME map, so a status can
// never show a date box that saves to the wrong column.
//
// "Won" is deliberately NOT a status the team can pick. It is a computed tag:
// reaching OPD Done or IPD Done IS the win, so storing "Won" as a separate
// status would only create a second thing to keep in sync.
export type AppointmentKind = "opdBooked" | "opdDone" | "ipdDone";

export interface AppointmentField {
  kind: AppointmentKind;
  /** Column written on the `leads` row. */
  column: "opd_booked_date" | "opd_done_date" | "ipd_done_date";
  /** Label + helper text shown next to the date input. */
  label: string;
  hint: string;
}

/** Status → its date column. Missing key means "this status has no date". */
const APPOINTMENT_BY_STATUS: Record<string, AppointmentField> = {
  "opd booked": {
    kind: "opdBooked",
    column: "opd_booked_date",
    label: "OPD appointment date",
    hint: "The day the patient is scheduled to attend OPD, rather than the day the booking was entered.",
  },
  "opd done": {
    kind: "opdDone",
    column: "opd_done_date",
    label: "OPD date",
    hint: "The day the OPD actually happened.",
  },
  "ipd booked": {kind:"ipdDone",column:"ipd_done_date",label:"IPD admission date",hint:"The planned day of admission; completion is recorded separately."},
  "ipd done": {
    kind: "ipdDone",
    column: "ipd_done_date",
    label: "IPD / surgery date",
    hint: "The day of admission and surgery.",
  },
};

/**
 * The date field this status owns, or null when it has none.
 *
 * Matching is by exact lowered value, NOT a regex: "OPD Booked" and "OPD Done"
 * differ by one word, and a loose /opd/ match would give both the same field.
 * Anything the clinic typed by hand ("ipd done - amit") simply gets no date
 * box rather than a wrong one.
 */
export function appointmentForStatus(status: string): AppointmentField | null {
  const value = (status ?? "").trim().toLowerCase();
  if (!value) return null;
  return APPOINTMENT_BY_STATUS[value] ?? null;
}

/** Pick one calendar row per lead, using only the lead's current status. */
export function selectCurrentStatusAppointments<
  T extends {
    lead: { id: string; status: string };
    kind: AppointmentKind;
    legacy_column: string | null;
    updated_at: string;
    starts_on: string;
    id: string;
  },
>(rows: T[]): T[] {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const group = grouped.get(row.lead.id) ?? [];
    group.push(row);
    grouped.set(row.lead.id, group);
  }

  const current: T[] = [];
  for (const group of grouped.values()) {
    const status = group[0].lead.status.trim().toLowerCase();
    const field = appointmentForStatus(status);
    const kind = status === "surgery completed" ? "ipdDone" : field?.kind;
    const column = status === "surgery completed" ? "ipd_done_date" : field?.column;
    if (!kind || !column) continue;

    const candidates = group.filter((row) => row.kind === kind);
    candidates.sort((a, b) => {
      const columnRank = Number(b.legacy_column === column) - Number(a.legacy_column === column);
      return columnRank || b.updated_at.localeCompare(a.updated_at) || b.starts_on.localeCompare(a.starts_on) || a.id.localeCompare(b.id);
    });
    if (candidates[0]) current.push(candidates[0]);
  }
  return current;
}

/**
 * Has this lead won? Reached an OPD or an IPD.
 *
 * "Surgery Completed" counts too — it is the canonical stage name and older
 * leads already carry it.
 */
export function isWonStatus(status: string): boolean {
  const value = (status ?? "").trim().toLowerCase();
  if (!value) return false;
  if (value === "won") return true;
  return value === "opd done" || value === "ipd done" || value === "surgery completed";
}

/** Every column that must exist on `leads` for appointments to save. */
export const APPOINTMENT_COLUMNS = [
  "opd_booked_date",
  "opd_done_date",
  "ipd_done_date",
] as const;

/** Local-calendar yyyy-mm-dd, or "" for the placeholders the table stores. */
export function normaliseAppointmentDate(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  if (!text || text === "-" || text === "--") return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}
