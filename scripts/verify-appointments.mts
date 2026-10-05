// Regression checks for the OPD / IPD appointment rules. Run with:
//   npm run verify:appointments
//
// The whole feature rests on ONE table (status → which date column it owns).
// If that table is ever edited carelessly, a date box can appear that saves to
// the wrong column, or "Won" can stop firing — and neither is visible until a
// patient's booking day quietly disappears from the calendar. So it is pinned
// here rather than trusted.
import assert from "node:assert/strict";

import {
  APPOINTMENT_COLUMNS,
  appointmentForStatus,
  isWonStatus,
  normaliseAppointmentDate,
} from "../lib/appointments.ts";
import { MASTER_DATA_SEED } from "../lib/master-data.ts";

// ---------------------------------------------------------------------------
// 1. Each appointment status owns its OWN column. "OPD Booked" and "OPD Done"
//    differ by one word — a loose /opd/ match would give both the same field
//    and silently overwrite the booking date when the status advanced.
// ---------------------------------------------------------------------------
assert.equal(appointmentForStatus("OPD Booked")?.column, "opd_booked_date", "OPD Booked owns the booking date");
assert.equal(appointmentForStatus("OPD Done")?.column, "opd_done_date", "OPD Done owns the OPD date");
assert.equal(appointmentForStatus("IPD Done")?.column, "ipd_done_date", "IPD Done owns the surgery date");

// ---------------------------------------------------------------------------
// 2. The three columns are all distinct — the whole reason for three columns.
// ---------------------------------------------------------------------------
assert.deepEqual(
  [...APPOINTMENT_COLUMNS],
  ["opd_booked_date", "opd_done_date", "ipd_done_date"],
  "each status writes to its own column",
);
assert.equal(
  new Set(APPOINTMENT_COLUMNS).size,
  3,
  "no two statuses share a column, so no date can overwrite another",
);

// ---------------------------------------------------------------------------
// 3. Only the three appointment statuses reveal a date box. Everything else —
//    including the non-surgical and dead-end statuses — must stay dateless, or
//    the Leads row would sprout an irrelevant input.
// ---------------------------------------------------------------------------
for (const status of ["New", "Follow Up", "Contacted", "Consultation Booked", "Surgery Completed"]) {
  assert.equal(appointmentForStatus(status), null, `${status} has no appointment date`);
}
for (const status of ["Not Interested", "Budget Issue", "DNP", "Dropped", "Invalid Number"]) {
  assert.equal(appointmentForStatus(status), null, `${status} must not show a date box`);
}

// ---------------------------------------------------------------------------
// 4. Matching tolerates the casing and padding a real spreadsheet brings, and
//    stays EXACT — a hand-typed "IPD done - Amit" gets no box rather than a
//    wrong one, because guessing would write to the wrong column.
// ---------------------------------------------------------------------------
assert.equal(appointmentForStatus("opd booked")?.kind, "opdBooked", "lower case still matches");
assert.equal(appointmentForStatus("  OPD Done  ")?.kind, "opdDone", "surrounding spaces still match");
assert.equal(appointmentForStatus("IPD DONE")?.kind, "ipdDone", "all caps still matches");
assert.equal(appointmentForStatus(""), null, "an empty status has no date");
assert.equal(appointmentForStatus("   "), null, "whitespace is not a status");
assert.equal(appointmentForStatus("OPD Booked extra"), null, "a near-miss is NOT matched");
assert.equal(appointmentForStatus("IPD Booked"), null, "IPD Booked is not an appointment status here");

// ---------------------------------------------------------------------------
// 6. "Won" is derived, never stored. Reaching an OPD or IPD IS the win.
// ---------------------------------------------------------------------------
assert.equal(isWonStatus("OPD Done"), true, "a completed OPD wins");
assert.equal(isWonStatus("IPD Done"), true, "a completed IPD wins");
assert.equal(isWonStatus("Surgery Completed"), true, "the canonical surgery stage wins");
assert.equal(isWonStatus("won"), true, "a legacy stored 'Won' row still reads as won");
assert.equal(isWonStatus("OPD Booked"), false, "BOOKING is not winning — the patient has not come yet");
assert.equal(isWonStatus("New"), false, "a new lead has not won");
assert.equal(isWonStatus("Dropped"), false, "a dropped lead has not won");
assert.equal(isWonStatus(""), false, "an empty status has not won");

// ---------------------------------------------------------------------------
// 7. A Won status must not fire on a SUBSTRING — "Surgery Scheduled" is still
//    in the future, and celebrating it early is worse than not celebrating.
// ---------------------------------------------------------------------------
assert.equal(isWonStatus("Surgery Scheduled"), false, "a scheduled surgery is not a win");
assert.equal(isWonStatus("IPD Booked"), false, "a booked IPD is not a win");

// ---------------------------------------------------------------------------
// 8. "Won" and "Lost" are gone from the picker; "Dropped" took over.
// ---------------------------------------------------------------------------
assert.ok(!MASTER_DATA_SEED.statuses.includes("Won"), "Won must not be selectable");
assert.ok(!MASTER_DATA_SEED.statuses.includes("Lost"), "Lost must not be selectable");
assert.ok(MASTER_DATA_SEED.statuses.includes("Dropped"), "Dropped replaces Lost in the picker");
for (const status of ["OPD Booked", "OPD Done", "IPD Done"]) {
  assert.ok(MASTER_DATA_SEED.statuses.includes(status), `${status} stays selectable`);
}

// ---------------------------------------------------------------------------
// 9. Dates normalise: the '-' placeholder means "unset", never a fake date.
// ---------------------------------------------------------------------------
assert.equal(normaliseAppointmentDate("2026-10-05"), "2026-10-05", "a real date passes through");
assert.equal(normaliseAppointmentDate("-"), "", "the table's dash placeholder means unset");
assert.equal(normaliseAppointmentDate("  "), "", "whitespace means unset");
assert.equal(normaliseAppointmentDate(null), "", "null means unset");
assert.equal(normaliseAppointmentDate(undefined), "", "undefined means unset");
assert.equal(normaliseAppointmentDate("05/10/2026"), "", "a non-ISO date is rejected rather than guessed");

console.log("✓ all appointment assertions passed");
console.log("  columns:", APPOINTMENT_COLUMNS.join(", "));
console.log("  won statuses: OPD Done, IPD Done, Surgery Completed");
console.log("  picker offers Won or Lost:", MASTER_DATA_SEED.statuses.includes("Won") || MASTER_DATA_SEED.statuses.includes("Lost"));
// ---------------------------------------------------------------------------
// 5. Every appointment status carries label + hint copy for its date box.
// ---------------------------------------------------------------------------
for (const status of ["OPD Booked", "OPD Done", "IPD Done"]) {
  const field = appointmentForStatus(status)!;
  assert.ok(field.label.length > 0, `${status} has a label`);
  assert.ok(field.hint.length > 0, `${status} has a helper line`);
}