// Regression checks for the attendance rules (clinic timezone, midnight
// sign-out, roster maths). Run with: npm run verify:attendance
import assert from "node:assert/strict";

import {
  ATTENDANCE_STATUSES,
  attendanceRate,
  buildTeamCards,
  clinicDate,
  formatClock,
  initialsFor,
  isAttendanceStatus,
  minutesIntoDay,
  needsFreshSignIn,
  normaliseStatus,
  sortByCheckIn,
  splitRoster,
  statusOn,
  summariseByEmployee,
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

// ---------------------------------------------------------------------------
// 8. The attendance RATE counts marks, not days in the month. A clinic with no
//    holiday calendar must not report a perfect month as 60% because the
//    denominator was 30 and nobody was marked on the Sundays.
// ---------------------------------------------------------------------------
assert.equal(attendanceRate({ present: 10, absent: 0, halfDay: 0, total: 10 }), 100, "a clean month is 100%");
assert.equal(
  attendanceRate({ present: 4, absent: 1, halfDay: 1, total: 6 }),
  75,
  "a half-day counts as half: (4 + 0.5) / 6 = 75%",
);
assert.equal(attendanceRate({ present: 0, absent: 3, halfDay: 0, total: 3 }), 0, "all absent is 0%, not NaN");
assert.equal(
  attendanceRate({ present: 0, absent: 0, halfDay: 0, total: 0 }),
  0,
  "an unmarked month reads 0 instead of dividing by zero",
);
assert.equal(
  attendanceRate({ present: 1, absent: 0, halfDay: 0, total: 3 }),
  33,
  "1 of 3 rounds to 33% rather than truncating",
);

// ---------------------------------------------------------------------------
// 9. Avatar initials survive the shapes a real name takes.
// ---------------------------------------------------------------------------
assert.equal(initialsFor("Ravi Sharma"), "RS", "first and last initial");
assert.equal(initialsFor("Chirag"), "C", "a single name gets one letter");
assert.equal(initialsFor("  Aditi   Devi  "), "AD", "extra spaces add no phantom initials");
assert.equal(initialsFor(""), "?", "an empty name still renders something");
assert.equal(initialsFor("   "), "?", "whitespace is not a name");

// ---------------------------------------------------------------------------
// 10. Per-employee cards: totals, average check-in, streak.
// ---------------------------------------------------------------------------
// employeeId is set EXPLICITLY, distinct from the row id — three rows for one
// person share an employeeId, which is exactly what the grouping relies on.
const day = (
  id: string,
  date: string,
  status: AttendanceRow["status"],
  checkInLabel: string,
  employeeId = id,
): AttendanceRow => ({ ...row(id, status), employeeId, date, checkInLabel });

const raviRows = [
  day("r1", "2026-09-28", "Present", "09:00", "ravi"),
  day("r2", "2026-09-29", "Present", "09:30", "ravi"),
  day("r3", "2026-09-30", "Half-Day", "-", "ravi"),
];
const meeraRows = [day("m1", "2026-09-28", "Absent", "-", "meera")];

const perEmployee = summariseByEmployee([...raviRows, ...meeraRows]);
assert.equal(perEmployee.length, 2, "three rows for Ravi and one for Meera make TWO cards");

const ravi = perEmployee.find((entry) => entry.employeeId === "ravi")!;
assert.equal(ravi.present, 2, "Ravi has two present days");
assert.equal(ravi.halfDay, 1, "Ravi has one half-day");
assert.equal(ravi.total, 3, "Ravi was marked three times");
assert.equal(ravi.rate, 83, "Ravi: (2 + 0.5) / 3 = 83%");
assert.equal(ravi.averageCheckIn, "09:15", "09:00 and 09:30 average to 09:15");
assert.equal(ravi.earliestCheckIn, "09:00", "earliest sign-in of the month");
assert.equal(ravi.latestCheckIn, "09:30", "latest sign-in of the month");
assert.equal(ravi.streak, 3, "the streak counts back from the last marked day");

const meera = perEmployee.find((entry) => entry.employeeId === "meera")!;
assert.equal(meera.rate, 0, "an absent-only month is 0%");
assert.equal(meera.streak, 0, "a trailing absent day breaks the streak");
assert.equal(meera.averageCheckIn, "-", "no sign-in means no average, not 00:00");

// A streak ends at the LAST MARKED day, so somebody on leave at month-end still
// shows the run they actually built. All three rows are ONE employee.
assert.equal(
  summariseByEmployee([
    day("s1", "2026-09-01", "Present", "09:00", "sam"),
    day("s2", "2026-09-02", "Present", "09:00", "sam"),
    day("s3", "2026-09-20", "Absent", "-", "sam"),
  ])[0].streak,
  0,
  "an absent day stops the streak dead",
);
assert.equal(
  summariseByEmployee([
    day("t1", "2026-09-01", "Present", "09:00", "sam"),
    day("t2", "2026-09-02", "Half-Day", "-", "sam"),
  ])[0].streak,
  2,
  "a half-day still counts toward the streak — the person showed up",
);

// Unparsable check-in labels must not poison the average.
assert.equal(
  summariseByEmployee([
    day("b1", "2026-09-01", "Present", "-", "bo"),
    day("b2", "2026-09-02", "Present", "10:00", "bo"),
  ])[0].averageCheckIn,
  "10:00",
  "a manager entry with no login time is skipped, not counted as midnight",
);
assert.equal(
  summariseByEmployee([day("c1", "2026-09-01", "Present", "99:99")])[0].averageCheckIn,
  "-",
  "a nonsense clock reads as missing",
);
assert.deepEqual(summariseByEmployee([]), [], "no marks means no cards");

// ---------------------------------------------------------------------------
// 11. buildTeamCards keeps employees with ZERO marks. Without this a newcomer
//     silently disappears from the register — exactly the person a manager
//     most needs to notice.
// ---------------------------------------------------------------------------
const cards = buildTeamCards(
  [
    { id: "ravi", name: "Ravi Sharma" },
    { id: "meera", name: "Meera Iyer" },
    { id: "n1", name: "New Joiner" },
  ],
  [...raviRows, ...meeraRows],
);
assert.equal(cards.length, 3, "all three employees get a card");
assert.equal(
  cards.map((entry) => entry.employeeName).join(", "),
  "Meera Iyer, New Joiner, Ravi Sharma",
  "cards are alphabetical so the strip reads like a roll",
);
const newcomer = cards.find((entry) => entry.employeeId === "n1")!;
assert.equal(newcomer.total, 0, "the newcomer has no marks yet");
assert.equal(newcomer.rate, 0, "no marks is 0%, never NaN or 100%");
assert.equal(newcomer.streak, 0, "no marks is no streak");
assert.equal(newcomer.averageCheckIn, "-", "no marks has no average");
assert.deepEqual(buildTeamCards([], []), [], "an empty roster makes no cards");

// ---------------------------------------------------------------------------
// 12. "Aaj" on a card reads one employee's status for one clinic day.
// ---------------------------------------------------------------------------
const todayRows = [
  day("r1", "2026-09-30", "Present", "09:05", "ravi"),
  day("m1", "2026-09-30", "Absent", "-", "meera"),
];
assert.equal(statusOn(todayRows, "ravi", "2026-09-30"), "Present", "Ravi is present today");
assert.equal(statusOn(todayRows, "meera", "2026-09-30"), "Absent", "Meera is absent today");
assert.equal(statusOn(todayRows, "ravi", "2026-09-29"), null, "an unmarked day is null, not Present");
assert.equal(statusOn(todayRows, "ghost", "2026-09-30"), null, "an unknown employee is null");
assert.equal(statusOn([], "ravi", "2026-09-30"), null, "no rows at all is null");

console.log("✓ all attendance assertions passed");
console.log("  clinic day:", clinicDate(new Date("2026-09-29T18:30:00Z")), "(18:30 UTC → next day in IST)");
console.log("  check-in label:", formatClock("2026-09-30T04:12:00Z"), "(04:12 UTC → 09:42 IST)");
console.log("  midnight rule:", needsFreshSignIn("2026-09-29", AFTER_MIDNIGHT_IST));
console.log("  month summary:", JSON.stringify(summary));