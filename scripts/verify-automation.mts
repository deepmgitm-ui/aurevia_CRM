// Regression checks for the workflow-automation rule engine (lib/automation.ts)
// and the master-data picklist helpers (lib/master-data.ts).
// Run with: npm run verify:automation
//
// Everything here is pure: no Supabase, no clock. `matchChanges` takes an
// explicit `now`, so "today" is pinned and the rules are asserted exactly as
// preview/run compute them.
import assert from "node:assert/strict";

import {
  ALL_RULES,
  AUTOMATION_CAP,
  addDaysKey,
  daysSinceIso,
  isStaleFollowUp,
  matchChanges,
  toFollowUpDate,
  todayKeyLocal,
  type LeadLite,
} from "../lib/automation.ts";
import {
  MASTER_DATA_SEED,
  mergeMasterDataLists,
  seedMasterData,
  withCurrentValue,
} from "../lib/master-data.ts";

const NOW = new Date(2026, 8, 29, 10, 0, 0); // 29 Sep 2026, local
const TODAY = todayKeyLocal(NOW);
assert.equal(TODAY, "2026-09-29");
const TOMORROW = addDaysKey(TODAY, 1);
assert.equal(TOMORROW, "2026-09-30");

function lead(overrides: Partial<LeadLite> & { id: string }): LeadLite {
  return {
    name: `Patient ${overrides.id}`,
    phone: "9999999999",
    status: "New",
    assigned_to: null,
    follow_up_date: "",
    updated_at: "2026-09-29T00:00:00+00:00",
    ...overrides,
  };
}

// 0. The five rules the UI offers are exactly the keys the engine understands.
assert.deepEqual(
  ALL_RULES.map((rule) => rule.key),
  ["welcome", "nudge", "overdue", "balance", "celebrate"],
);

// 1. Date handling: both stored formats normalize to the same day key, and only
//    a PAST day counts as stale (today's follow-up is still on time).
assert.equal(toFollowUpDate("05/09/2026"), "2026-09-05");
assert.equal(toFollowUpDate("2026-09-05"), "2026-09-05");
assert.equal(toFollowUpDate("garbage"), "");
assert.equal(isStaleFollowUp("28/09/2026", TODAY), true);
assert.equal(isStaleFollowUp("29/09/2026", TODAY), false);

// 2. welcome schedules tomorrow for new leads with missing/overdue follow-ups.
{
  const result = matchChanges(
    "welcome",
    [
      lead({ id: "a", status: "New", follow_up_date: "" }),
      lead({ id: "b", status: "New", follow_up_date: "2026-10-05" }), // future callback → skip
      lead({ id: "c", status: "Contacted" }), // not New → skip
      lead({ id: "d", status: "New", follow_up_date: "2026-09-25" }), // overdue → include
      lead({ id: "e", status: "New", follow_up_date: "2026-10-08" }), // future → skip
    ],
    [],
    NOW,
  );
  assert.deepEqual(result.changes.map((change) => change.leadId), ["a", "d"]);
  assert.equal(result.scanned, 5);
  assert.deepEqual(result.changes[0].patch, { followUpDate: TOMORROW });
}

// 3. nudge: active leads inactive 7+ days get tomorrow's callback + a note.
{
  const result = matchChanges(
    "nudge",
    [
      lead({ id: "a", status: "Follow-Up", updated_at: "2026-09-22T00:00:00+00:00" }), // 7 days → include
      lead({ id: "b", status: "Follow-Up", updated_at: "2026-09-26T00:00:00+00:00" }), // 3 days → skip
      lead({ id: "c", status: "OPD Booked", updated_at: "2026-09-01T00:00:00+00:00" }), // not warm → skip
    ],
    [],
    NOW,
  );
  assert.deepEqual(result.changes.map((change) => change.leadId), ["a"]);
  assert.equal(result.changes[0].patch.followUpDate, TOMORROW);
  assert.match(String(result.changes[0].patch.note), /7\+ days/);
}

// 4. overdue active leads are rescheduled; due-today and closed records are skipped.
{
  const result = matchChanges(
    "overdue",
    [
      lead({ id: "a", status: "New", follow_up_date: "20/09/2026" }),
      lead({ id: "b", status: "New", follow_up_date: "2026-09-29" }), // today → on time
      lead({ id: "c", status: "Lost", follow_up_date: "2026-09-01" }), // closed → skip
    ],
    [],
    NOW,
  );
  assert.deepEqual(result.changes.map((change) => change.leadId), ["a"]);
  assert.equal(result.changes[0].patch.followUpDate, TOMORROW);
}


// 5. balance: unassigned open leads round-robin across agents, closed ones are
//    left alone, and an empty roster still resolves to the "-" placeholder.
{
  const result = matchChanges(
    "balance",
    [
      lead({ id: "a", assigned_to: null }),
      lead({ id: "b", assigned_to: " - " }),
      lead({ id: "c", assigned_to: "Ravi" }), // already owned → skip
      lead({ id: "d", assigned_to: null, status: "Lost" }), // closed → skip
      lead({ id: "e", assigned_to: null, status: "Won" }), // closed → skip
    ],
    ["Ravi", "Sana"],
    NOW,
  );
  assert.deepEqual(
    result.changes.map((change) => [change.leadId, change.patch.assignedTo]),
    [
      ["a", "Ravi"],
      ["b", "Sana"],
    ],
  );
  const empty = matchChanges("balance", [lead({ id: "x" })], [], NOW);
  assert.equal(empty.changes[0].patch.assignedTo, "-");
}

// 6. celebrate: completed surgeries get a timeline note.
{
  const result = matchChanges(
    "celebrate",
    [
      lead({ id: "a", status: "surgery completed" }),
      lead({ id: "b", status: "Consultation Attended" }),
    ],
    [],
    NOW,
  );
  assert.deepEqual(result.changes.map((change) => change.leadId), ["a"]);
  assert.deepEqual(result.changes[0].patch, {
    note: "Automation: surgery completed — marked as a win.",
  });
}

// 7. The cap protects the whole table: one run can never touch more than 200 rows.
{
  const many = Array.from({ length: AUTOMATION_CAP + 25 }, (_, index) =>
    lead({ id: `bulk-${index}` }),
  );
  const result = matchChanges("welcome", many, [], NOW);
  assert.equal(result.changes.length, AUTOMATION_CAP);
  assert.equal(result.scanned, many.length);
}

// 8. Every change is self-describing: preview can show WHO owns the lead and WHY
//    it matched, before anything is written.
{
  const result = matchChanges(
    "overdue",
    [lead({ id: "a", status: "New", follow_up_date: "01/09/2026", assigned_to: "Sana" })],
    [],
    NOW,
  );
  assert.equal(result.changes[0].reason.length > 0, true);
  assert.equal(result.changes[0].assignedTo, "Sana");
  assert.equal(result.changes[0].phone, "9999999999");
}

// 9. Master data: the seed always ships every list, and seeding never leaks the
//    same array instance (a settings edit must not mutate the seed).
{
  const first = seedMasterData();
  const second = seedMasterData();
  assert.deepEqual(first.lists.statuses, MASTER_DATA_SEED.statuses);
  assert.notEqual(first.lists.statuses, second.lists.statuses);
  assert.equal(first.fromDatabase, false);
  first.lists.statuses.push("Mutated");
  assert.equal(second.lists.statuses.includes("Mutated"), false);
}

// 10. withCurrentValue keeps a stored value selectable, case-insensitively, and
//     ignores the "-" placeholder every empty cell carries.
{
  const options = ["New", "Contacted"];
  assert.deepEqual(withCurrentValue(options, "contacted"), options);
  assert.deepEqual(withCurrentValue(options, "  Legacy Value "), ["New", "Contacted", "Legacy Value"]);
  assert.deepEqual(withCurrentValue(options, "-"), options);
  assert.deepEqual(withCurrentValue(options, ""), options);
  assert.deepEqual(options, ["New", "Contacted"]); // never mutated
}

// 11. mergeMasterDataLists appends DB rows without duplicating the seed.
{
  const merged = mergeMasterDataLists(seedMasterData(), {
    statuses: ["new", "OPD Booked", "-", "  "],
    cities: ["Indore"],
  });
  assert.equal(merged.lists.statuses.filter((value) => value.toLowerCase() === "new").length, 1);
  assert.equal(merged.lists.statuses.includes("OPD Booked"), true);
  assert.equal(merged.lists.statuses.includes("-"), false);
  assert.deepEqual(merged.lists.cities.slice(-1), ["Indore"]);
}

console.log("✓ all automation + master data assertions passed");
console.log(`  rules: ${ALL_RULES.map((rule) => rule.key).join(", ")}`);
console.log(`  cap: ${AUTOMATION_CAP} rows/run, date math pinned to ${TODAY} → ${TOMORROW}`);
console.log(`  master data lists: ${Object.keys(MASTER_DATA_SEED).join(", ")}`);
console.log("  welcome/nudge/overdue/balance/celebrate matchers verified");


assert.equal(isStaleFollowUp("", TODAY), false);
assert.equal(daysSinceIso("2026-09-22T00:00:00+00:00", TODAY), 7);
assert.equal(daysSinceIso("not-a-date", TODAY), null);
