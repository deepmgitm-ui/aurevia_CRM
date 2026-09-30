// Regression checks for the attendance rules (clinic timezone, midnight
// sign-out, roster maths). Run with: npm run verify:attendance
import assert from "node:assert/strict";

import {
  ATTENDANCE_STATUSES,
  clinicDate,
  formatClock,
  isAttendanceStatus,
  minutesIntoDay,
  needsFreshSignIn,
  normaliseStatus,
  sortByCheckIn,
  splitRoster,
  summariseMonth,
  type AttendanceRow,
} from "../lib/attendance.ts";

// ---------------------------------------------------------------------------
// 1. "Today" is Delhi's calendar day, not UTC's. 18:30 UTC is already the
//    NEXT day in India, so a UTC-based check-in date would file the evening
//    sign-in under tomorrow.
// ---------------------------------------------------------------------------
assert.equal(clinicDate(new Date("2026-09-29T18:30:00Z")), "2026-09-30", "18:30 UTC is 30 Sep in IST");
assert.equal(clinicDate(new Date("2026-09-29T15:00:00Z")), "2026-09-29", "20:30 IST stays on the 29th");
assert.equal(clinicDate(new Date("2026-01-01T00:00:00+05:30")), "2026-01-01", "IST midnight belongs to the 1st");
assert.equal(clinicDate(new Date("2026-12-31T19:00:00Z")), "2027-01-01", "year rolls over in IST");

// ---------------------------------------------------------------------------
// 2. Check-in times print in the clinic's clock, not the server's.
// ---------------------------------------------------------------------------
assert.equal(formatClock("2026-09-30T04:12:00Z"), "09:42", "04:12 UTC is 09:42 in IST");
assert.equal(formatClock("2026-09-30T14:05:00Z"), "19:35", "14:05 UTC is 19:35 in IST");
assert.equal(formatClock("not-a-date"), "-", "a broken timestamp reads as missing, not NaN");
assert.equal(minutesIntoDay(new Date("2026-09-30T04:12:00Z")), 9 * 60 + 42, "582 minutes into the IST day");

// ---------------------------------------------------------------------------
// 3. A session opened on an earlier clinic day is dead: sign in again.
// ---------------------------------------------------------------------------
const AFTER_MIDNIGHT_IST = new Date("2026-09-29T20:00:00Z"); // 01:30 IST on the 30th
assert.equal(needsFreshSignIn("2026-09-29", AFTER_MIDNIGHT_IST), true, "a stamp from yesterday needs a fresh sign-in");
assert.equal(needsFreshSignIn("2026-09-30", AFTER_MIDNIGHT_IST), false, "today's stamp keeps the session");
assert.equal(needsFreshSignIn(undefined, AFTER_MIDNIGHT_IST), true, "no stamp at all must force a sign-in");
assert.equal(needsFreshSignIn("", AFTER_MIDNIGHT_IST), true, "an empty stamp must force a sign-in");

// ---------------------------------------------------------------------------
// 4. Only the three real statuses are accepted; junk from the DB is coerced
//    rather than rendered raw.
// ---------------------------------------------------------------------------
assert.deepEqual([...ATTENDANCE_STATUSES], ["Present", "Absent", "Half-Day"], "the register's three states");
for (const status of ATTENDANCE_STATUSES) assert.ok(isAttendanceStatus(status), `${status} is valid`);
assert.ok(!isAttendanceStatus("presnt"), "a typo is not a status");
assert.ok(!isAttendanceStatus("present"), "the statuses are case-sensitive, so a lower-case guess is not one");
assert.ok(!isAttendanceStatus(null), "null is not a status");
assert.equal(normaliseStatus("Half-Day"), "Half-Day", "a real status passes through");
assert.equal(normaliseStatus("half-day"), "Present", "wrong case falls back rather than rendering junk");
assert.equal(normaliseStatus(undefined), "Present", "a missing status falls back");

// ---------------------------------------------------------------------------
// 5. A roster splits into marked / missing so the admin sees who never logged in.
// ---------------------------------------------------------------------------
const roster = [{ employeeId: "a" }, { employeeId: "b" }, { employeeId: "c" }];
const marks = new Map([
  ["a", "Present" as const],
  ["c", "Absent" as const],
]);
const split = splitRoster(roster, marks);
assert.equal(split.marked.length, 2, "two employees have a mark");
assert.equal(split.missing.length, 1, "one employee is missing");
assert.equal(split.missing[0].employeeId, "b", "the missing one is the one without a row");
assert.equal(splitRoster([], new Map()).missing.length, 0, "an empty roster is not an error");

// ---------------------------------------------------------------------------
// 6. Month totals count each status once, and never invent rows.
// ---------------------------------------------------------------------------
const row = (id: string, status: AttendanceRow["status"]): AttendanceRow => ({
  id,
  employeeId: id,
  employeeName: `Employee ${id}`,
  date: "2026-09-30",
  status,
  checkInAt: "2026-09-30T04:12:00Z",
  checkInLabel: "09:42",
  note: "",
  autoMarked: true,
  markedByName: "-",
});
const summary = summariseMonth([row("1", "Present"), row("2", "Present"), row("3", "Absent"), row("4", "Half-Day")]);
assert.deepEqual(summary, { present: 2, absent: 1, halfDay: 1, total: 4 }, "month totals add up");
assert.deepEqual(
  summariseMonth([]),
  { present: 0, absent: 0, halfDay: 0, total: 0 },
  "an unmarked month totals zero instead of NaN",
);

// ---------------------------------------------------------------------------
// 7. The earliest check-in reads first, and undated rows sink to the bottom
//    (a manager's manual entry has no sign-in time to compare).
// ---------------------------------------------------------------------------
const at = (id: string, time: string | null): AttendanceRow => ({
  ...row(id, "Present"),
  checkInAt: time,
  checkInLabel: time ? formatClock(time) : "-",
  autoMarked: time !== null,
});
const undated = at("9", null);
const ordered = sortByCheckIn([undated, at("2", "2026-09-30T04:00:00Z"), at("1", "2026-09-30T03:30:00Z")]);
assert.deepEqual(
  ordered.map((item) => item.employeeName),
  ["Employee 1", "Employee 2", "Employee 9"],
  "earliest check-in first, undated last",
);
assert.deepEqual(
  sortByCheckIn([at("b", null), at("a", null)]).map((item) => item.employeeName),
  ["Employee a", "Employee b"],
  "with no times at all, fall back to name order",
);

console.log("✓ all attendance assertions passed");
console.log("  clinic day:", clinicDate(new Date("2026-09-29T18:30:00Z")), "(18:30 UTC → next day in IST)");
console.log("  check-in label:", formatClock("2026-09-30T04:12:00Z"), "(04:12 UTC → 09:42 IST)");
console.log("  midnight rule:", needsFreshSignIn("2026-09-29", AFTER_MIDNIGHT_IST));
console.log("  month summary:", JSON.stringify(summary));