import assert from "node:assert/strict";
import { CALENDAR_ENTRY_TYPES, calendarAgendaWindow, calendarPhone, shouldSyncLeadStatus, validateCalendarEntry, type CalendarEntryInput } from "../lib/calendar-entry.ts";
import { appointmentForStatus, selectCurrentStatusAppointments } from "../lib/appointments.ts";

const entry: CalendarEntryInput = { mode: "new", kind: "opdBooked", date: "2026-10-11", name: "Test patient", phone: "+91 98765 43210", city: "", remarks: "", assignedTo: "", updateStatus: false };
for (const [kind, item] of Object.entries(CALENDAR_ENTRY_TYPES)) {
  assert.equal(appointmentForStatus(item.status)?.column, item.column);
  assert.equal(appointmentForStatus(item.status)?.kind, kind);
}
const appointments = [
  { id: "old-opd", kind: "opdBooked" as const, legacy_column: null, updated_at: "2026-10-16T08:00:00Z", starts_on: "2026-10-16", lead: { id: "lead-1", status: "IPD Booked" } },
  { id: "current-ipd", kind: "ipdDone" as const, legacy_column: "ipd_done_date", updated_at: "2026-10-17T08:00:00Z", starts_on: "2026-10-20", lead: { id: "lead-1", status: "IPD Booked" } },
  { id: "old-ipd", kind: "ipdDone" as const, legacy_column: null, updated_at: "2026-10-16T08:00:00Z", starts_on: "2026-10-20", lead: { id: "lead-2", status: "OPD Booked" } },
  { id: "current-opd", kind: "opdBooked" as const, legacy_column: "opd_booked_date", updated_at: "2026-10-17T08:00:00Z", starts_on: "2026-10-18", lead: { id: "lead-2", status: "OPD Booked" } },
  { id: "stale-lead", kind: "opdBooked" as const, legacy_column: null, updated_at: "2026-10-17T08:00:00Z", starts_on: "2026-10-18", lead: { id: "lead-3", status: "New" } },
];
assert.deepEqual(selectCurrentStatusAppointments(appointments).map((row) => row.id).sort(), ["current-ipd", "current-opd"], "one current-status appointment per lead is shown; old visits and non-appointment statuses are hidden");
assert.equal(validateCalendarEntry(entry), null);
assert.equal(calendarPhone(entry.phone), "9876543210");
assert.equal(calendarPhone(""), "-");
assert.equal(shouldSyncLeadStatus("booked"), true);
assert.equal(shouldSyncLeadStatus("completed"), true);
assert.equal(shouldSyncLeadStatus("cancelled"), false);
assert.equal(shouldSyncLeadStatus("no_show"), false);
assert.ok(validateCalendarEntry({ ...entry, date: "2026-02-30" }));
assert.equal(validateCalendarEntry({ ...entry, date: "2028-02-29" }), null);
assert.ok(validateCalendarEntry({ ...entry, kind: "__proto__" as CalendarEntryInput["kind"] }));
assert.ok(validateCalendarEntry({ ...entry, name: " " }));
assert.ok(validateCalendarEntry({ ...entry, phone: "123" }));
assert.ok(validateCalendarEntry({ ...entry, mode: "existing" }));
assert.equal(validateCalendarEntry({ ...entry, mode: "existing", leadId: "00000000-0000-4000-8000-000000000001", expectedUpdatedAt: "2026-10-11T00:00:00Z" }), null);
assert.deepEqual(calendarAgendaWindow("2026-10-11"), { pastStart: "2026-07-13", upcomingEnd: "2027-01-08" });
assert.deepEqual(calendarAgendaWindow("2028-03-01"), { pastStart: "2027-12-02", upcomingEnd: "2028-05-29" });
console.log("✓ calendar entry validation, phone identity, history window and year/leap boundaries passed");
