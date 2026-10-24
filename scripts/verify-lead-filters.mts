// Regression checks for the drill-down lead filters + age buckets.
// Run with: npm run verify:lead-filters
import assert from "node:assert/strict";

import {
  AGE_BUCKETS,
  AGE_CHIP_BUCKETS,
  EMPTY_LEAD_FILTERS,
  NEW_LEAD_WINDOW_DAYS,
  ageBucketFor,
  ageBucketLabel,
  ageBucketWindow,
  andClauses,
  blankColumnClause,
  describeActiveFilters,
  filterChipLabels,
  hasLeadFilters,
  inListExpression,
  isLeadBucketKey,
  isNewLead,
  leadsHref,
  leadAgeInDays,
  isMonthFilterKey,
  monthFilterKey,
  monthFilterLabel,
  monthWindow,
  parseLeadFilters,
  prettifyFilterKey,
  relativeLeadAge,
  shortLeadAge,
  stageFilterKeys,
  tallyTreatments,
  treatmentOrExpression,
  type LeadListFilters,
} from "../app/dashboard/lead-filters.ts";
import type { AnalyticsLead, StageKey } from "../app/dashboard/overview/analytics.ts";
import { assignmentOrExpression } from "../lib/lead-assignment-filter.ts";
import { LEAD_STATUS_OPTIONS, leadStatusStorageValues } from "../lib/lead-status.ts";
import { STAGE_TARGET_STATUS, stageForStatus } from "../app/dashboard/overview/analytics.ts";

// ---------------------------------------------------------------------------
// 1. Round trip: a chart click link parses back to the exact same filter set.
// ---------------------------------------------------------------------------
const original: LeadListFilters = {
  ...EMPTY_LEAD_FILTERS,
  q: "",
  stage: "booked,attended,surgery",
  treatment: "other",
  except: "hair,skin",
  age: "today",
  month: "2026-03",
  city: "Mumbai",
  source: "Meta Ads",
  assigned: "Ravi Sharma",
  assignmentStatus: "",
  status: "",
};
const href = leadsHref(original);
assert.ok(href.startsWith("/dashboard/leads?"), `unexpected href: ${href}`);
const parsed = parseLeadFilters(Object.fromEntries(new URL(`http://localhost${href}`).searchParams));
assert.deepEqual(parsed, original, "round trip must preserve every filter");

// Empty values are dropped; `except` only survives together with treatment=other.
assert.equal(leadsHref({ city: "Pune" }), "/dashboard/leads?month=all&city=Pune");
assert.equal(leadsHref({ except: "hair" }), "/dashboard/leads?month=all");
assert.equal(leadsHref(EMPTY_LEAD_FILTERS), "/dashboard/leads");

// Employee lead categories: DNP includes its retry variants, and daily New
// Leads drill down to assignments received during the selected IST date.
const dnpFilters = parseLeadFilters({ bucket: "dnp" });
assert.equal(dnpFilters.bucket, "dnp");
assert.deepEqual(describeActiveFilters(dnpFilters), ["DNP"]);
const newLeadsHref = leadsHref({ work: "assigned", day: "2026-10-23", allMonths: true });
const newLeadsFilters = parseLeadFilters(Object.fromEntries(new URL(`http://localhost${newLeadsHref}`).searchParams));
assert.equal(newLeadsFilters.work, "assigned");
assert.equal(newLeadsFilters.day, "2026-10-23");

// Every current-status card opens that exact all-time status list, scoped to
// the selected agent when one is supplied.
for (const status of LEAD_STATUS_OPTIONS) {
  const cardHref = leadsHref({ assigned: "Atul Pandey", status, age: "", month: "", allMonths: true });
  const cardFilters = parseLeadFilters(Object.fromEntries(new URL(`http://localhost${cardHref}`).searchParams));
  assert.equal(cardFilters.assigned, "Atul Pandey");
  assert.equal(cardFilters.status, status);
  assert.equal(cardFilters.allMonths, true);
  assert.ok(leadStatusStorageValues(status).includes(status), `${status} drill-down includes the current stored value`);
}
assert.ok(leadStatusStorageValues("DNP2").includes("DNP 2"), "DNP2 drill-down includes the legacy spaced spelling");
assert.ok(leadStatusStorageValues("DNP3").includes("DNP 3"), "DNP3 drill-down includes the legacy spaced spelling");
assert.ok(leadStatusStorageValues("RNR").includes("Not Reachable"), "RNR drill-down includes its legacy label");
const workflowHref = leadsHref({ assigned: "Atul Pandey", bucket: "followup", allMonths: true });
const workflowFilters = parseLeadFilters(Object.fromEntries(new URL(`http://localhost${workflowHref}`).searchParams));
assert.equal(workflowFilters.bucket, "followup", "workflow card links preserve their exact bucket");
assert.equal(hasLeadFilters(workflowFilters), true, "workflow bucket activates the lead filter summary");
assert.ok(describeActiveFilters(workflowFilters).includes("Follow-up"), "workflow bucket has a readable filter label");
assert.equal(parseLeadFilters({ bucket: "unsupported" }).bucket, "", "unknown workflow buckets are ignored");

const assignmentBatchId = "4bbd4903-a954-4a6c-9ba5-11b152ced04d";
const assignmentBatchHref = leadsHref({ assignmentBatchId, allMonths: true });
assert.equal(
  parseLeadFilters(Object.fromEntries(new URL(`http://localhost${assignmentBatchHref}`).searchParams)).assignmentBatchId,
  assignmentBatchId,
  "assignment batch links preserve their exact batch id",
);
assert.equal(parseLeadFilters({ assignmentBatchId: "not-a-uuid" }).assignmentBatchId, "", "invalid assignment batch IDs are ignored");

// ---------------------------------------------------------------------------
// 2. Stage keys: valid ones kept in canonical order, junk silently dropped.
// ---------------------------------------------------------------------------
assert.deepEqual(stageFilterKeys("surgery,booked,nonsense"), ["booked", "surgery"]);
assert.deepEqual(stageFilterKeys(""), []);
assert.deepEqual(stageFilterKeys(" surgery , booked, junk"), ["booked", "surgery"]);

// ---------------------------------------------------------------------------
// 3. Chips: never a raw URL slug, always a human label.
// ---------------------------------------------------------------------------
assert.equal(hasLeadFilters(EMPTY_LEAD_FILTERS), false);
assert.equal(hasLeadFilters(parsed), true);
assert.deepEqual(describeActiveFilters(parsed), [
  "OPD Booked",
  "OPD Done",
  "Won",
  "Other",
  "Today",
  "Mar 2026",
  "Mumbai",
  "Meta Ads",
  "Ravi Sharma",
]);
const unassignedFilters = parseLeadFilters({ assignmentStatus: "unassigned" });
assert.equal(unassignedFilters.assignmentStatus, "unassigned");
assert.ok(hasLeadFilters(unassignedFilters));
assert.deepEqual(describeActiveFilters(unassignedFilters), ["Unassigned leads"]);
assert.equal(
  parseLeadFilters({ assignmentStatus: "unknown" }).assignmentStatus,
  "",
  "unsupported assignment filters are ignored",
);
assert.equal(
  assignmentOrExpression(false),
  'assigned_to.is.null,assigned_to.eq."",assigned_to.eq.-,assigned_to.eq.Unassigned',
  "assignment search defaults to all recognized unassigned records",
);
assert.equal(assignmentOrExpression(true), null, "including assigned leads intentionally removes the unassigned-only filter");
const batchAssignmentFilter = assignmentOrExpression(false, "12345678-1234-1234-1234-123456789abc")!;
assert.ok(batchAssignmentFilter.includes("assignment_batch_id.is.null"));
assert.ok(batchAssignmentFilter.includes("assignment_batch_id.neq.12345678-1234-1234-1234-123456789abc"));
assert.equal((batchAssignmentFilter.match(/and\(/g) ?? []).length, 8, "both assignment conditions share one PostgREST or expression");
assert.deepEqual(leadStatusStorageValues("Follow-Up"), ["Follow-Up", "Follow Up", "Contacted"], "Follow-Up status filter matches legacy spellings");
assert.equal(parseLeadFilters({ bucket: "lost" }).bucket, "lost", "Lost card drill-down remains filterable");
assert.equal(isLeadBucketKey("lost"), true, "Lost is accepted by both URL parsing and server query resolution");
assert.equal(isLeadBucketKey("unknown"), false, "unsupported workflow buckets are rejected by server query resolution");
assert.equal(prettifyFilterKey("eye-checkup"), "Eye checkup");
assert.equal(filterChipLabels().surgery, "Won");
assert.equal(stageForStatus("Wrong Number"), "lost", "Wrong Number follows the same Lost classification used by closed-lead counts");

// ---------------------------------------------------------------------------
// 4. Age windows: bounded single/open day ranges computed server-side.
// ---------------------------------------------------------------------------
const reference = new Date(2026, 8, 28, 13, 45); // 28 Sep 2026, afternoon
assert.deepEqual(
  AGE_BUCKETS.map((bucket) => bucket.key),
  ["today", "yesterday", "d2", "d3", "d4", "d5", "d6", "d7", "w1", "w2", "w3", "older"],
);
// The chip row stops at 3 weeks: "older" is served by the month picker, which
// names the actual month instead of saying "older".
assert.deepEqual(
  AGE_CHIP_BUCKETS.map((bucket) => bucket.key),
  ["today", "yesterday", "d2", "d3", "d4", "d5", "d6", "d7", "w1", "w2", "w3"],
);
assert.equal(ageBucketLabel("today"), "Today");
// "1 day ago" is named the way the team asked for it, with yesterday kept in the
// label so the chip is never ambiguous.
assert.equal(ageBucketLabel("yesterday"), "1 day ago (Yesterday)");
assert.equal(ageBucketLabel("d7"), "7 days ago");
assert.equal(ageBucketLabel("w1"), "1 week ago");
assert.equal(ageBucketLabel("weird"), "All time");

// The day ladder must be gapless: every age from 0 to 27 days old lands in its
// own named bucket, which is what "1 day, then 2,3,4,5,6,7, then 1 week, 2 weeks"
// asks for.
for (let days = 0; days <= 27; days++) {
  const date = new Date(2026, 8, 28 - days);
  const bucket = ageBucketFor(date, reference);
  assert.ok(bucket, `${days} days ago must fall in a bucket`);
  if (days >= 1 && days <= 7) {
    assert.equal(bucket, days === 1 ? "yesterday" : `d${days}`, `${days} days ago bucket`);
  }
  if (days >= 8 && days <= 13) assert.equal(bucket, "w1", `${days} days ago is 1 week`);
  if (days >= 14 && days <= 20) assert.equal(bucket, "w2", `${days} days ago is 2 weeks`);
  if (days >= 21 && days <= 27) assert.equal(bucket, "w3", `${days} days ago is 3 weeks`);
}
assert.equal(
  ageBucketFor(new Date(2026, 7, 31), reference),
  "older",
  "28 days ago is the open-ended bucket the month picker serves",
);
assert.equal(ageBucketFor(new Date(2026, 8, 1), reference), "w3", "27 days ago is still 3 weeks");

const todayWindow = ageBucketWindow("today", reference)!;
assert.equal(todayWindow.fromIso, new Date(2026, 8, 28).toISOString());
assert.equal(todayWindow.toIso, new Date(2026, 8, 29).toISOString());

const yesterdayWindow = ageBucketWindow("yesterday", reference)!;
assert.equal(yesterdayWindow.fromIso, new Date(2026, 8, 27).toISOString());
assert.equal(yesterdayWindow.toIso, new Date(2026, 8, 28).toISOString());

const weekWindow = ageBucketWindow("w1", reference)!;
assert.equal(weekWindow.fromIso, new Date(2026, 8, 15).toISOString());
assert.equal(weekWindow.toIso, new Date(2026, 8, 21).toISOString());

const sevenDayWindow = ageBucketWindow("d7", reference)!;
assert.equal(sevenDayWindow.fromIso, new Date(2026, 8, 21).toISOString());
assert.equal(sevenDayWindow.toIso, new Date(2026, 8, 22).toISOString());

const olderWindow = ageBucketWindow("older", reference)!;
assert.equal(olderWindow.fromIso, null);
assert.ok(olderWindow.toIso);
assert.equal(ageBucketWindow("weird", reference), null);

// The client-side bucketing (ageBucketFor) and the server window must agree for
// every lead age: a lead `ageBucketFor` puts in a bucket lies inside that
// bucket's created_at window — otherwise chips and lists would disagree.
for (let days = 0; days < 400; days++) {
  const date = new Date(2026, 8, 28 - days);
  const bucket = ageBucketFor(date, reference);
  assert.ok(bucket, `no bucket for ${days} days ago`);
  const window = ageBucketWindow(bucket!, reference)!;
  const time = date.getTime();
  const context = `lead ${days} days old → bucket "${bucket}"`;
  if (window.fromIso) assert.ok(time >= new Date(window.fromIso).getTime(), `${context}: before window`);
  assert.ok(time < new Date(window.toIso!).getTime(), `${context}: after window`);
}

// ---------------------------------------------------------------------------
// 4b. The month picker: the replacement for the old vague "Month" chip. It must
//     name a real month, cover that month exactly (February included), and
//     survive junk from the URL.
// ---------------------------------------------------------------------------
assert.equal(monthFilterKey(new Date(2026, 2, 15)), "2026-03", "key is yyyy-mm");
assert.equal(monthFilterKey(new Date(2026, 11, 1)), "2026-12", "December is month 12, not 0");
assert.equal(monthFilterKey(new Date(2026, 0, 31)), "2026-01", "January is month 01");

assert.ok(isMonthFilterKey("2026-03"), "a real month key is accepted");
assert.ok(!isMonthFilterKey("2026-13"), "month 13 does not exist");
assert.ok(!isMonthFilterKey("2026-00"), "month 0 does not exist");
assert.ok(!isMonthFilterKey("2026-3"), "a one-digit month is rejected, not guessed");
assert.ok(!isMonthFilterKey("March"), "a month NAME is rejected, not guessed");
assert.ok(!isMonthFilterKey(""), "empty is rejected");

assert.equal(monthFilterLabel("2026-03"), "Mar 2026", "the dropdown shows a readable month");
assert.equal(monthFilterLabel("junk"), "All time", "junk never renders as a month");

// February: the window must end on the 1st of March, never a guessed "31 days".
const feb = monthWindow("2026-02")!;
assert.equal(feb.fromIso, new Date(2026, 1, 1).toISOString(), "Feb starts on the 1st");
assert.equal(feb.toIso, new Date(2026, 2, 1).toISOString(), "Feb ends where March begins");
assert.equal(monthWindow("2026-13"), null, "an impossible month yields no window");
assert.equal(monthWindow("nope"), null, "junk yields no window");

// The URL round trip: ?month= survives parse → href, junk does not.
assert.equal(parseLeadFilters({ month: "2026-03" }).month, "2026-03", "a valid month parses");
assert.equal(parseLeadFilters({ month: "2026-13" }).month, "", "an impossible month is dropped");
assert.equal(parseLeadFilters({ month: "<script>" }).month, "", "junk is dropped, not rendered");
assert.ok(
  leadsHref({ ...EMPTY_LEAD_FILTERS, month: "2026-03" }).includes("month=2026-03"),
  "the month survives the link builder",
);
assert.ok(
  !leadsHref({ ...EMPTY_LEAD_FILTERS, month: "" }).includes("month="),
  "an empty month adds nothing to the URL",
);

// A month selection counts as an active filter (the amber banner depends on it).
assert.ok(hasLeadFilters({ ...EMPTY_LEAD_FILTERS, month: "2026-03" }), "month counts as a filter");
assert.ok(
  describeActiveFilters({ ...EMPTY_LEAD_FILTERS, month: "2026-03" }).includes("Mar 2026"),
  "the chip reads as a month, not a raw URL value",
);

// ---------------------------------------------------------------------------
// 5. SQL fragment helpers used by resolveLeadFilters / applyLeadFilters.
// ---------------------------------------------------------------------------
assert.equal(inListExpression(["OPD Done", "won"]), '"OPD Done",won'); // space quotes the value
assert.ok(blankColumnClause("disease").includes("disease.is.null"));
assert.equal(andClauses([]), "");
assert.equal(andClauses(["a"]), "a");
assert.equal(andClauses(["a", "b"]), "and(a,b)");
const lasikExpression = treatmentOrExpression("lasik");
assert.ok(lasikExpression?.includes("disease.ilike.%lasik%"), "lasik must build a LIKE net");
assert.ok(treatmentOrExpression("lasik", ["remarks"])?.includes("remarks.ilike.%lasik%"));
assert.equal(treatmentOrExpression("other"), null); // folded segments resolve via distinct values
assert.equal(treatmentOrExpression("unrecorded"), null);

// ---------------------------------------------------------------------------
// 6. "Added yesterday / 2 weeks ago" labels + the NEW-lead window.
// ---------------------------------------------------------------------------
assert.equal(NEW_LEAD_WINDOW_DAYS, 2);
assert.equal(leadAgeInDays("28/09/2026", reference), 0); // Meta / Excel format
assert.equal(leadAgeInDays("2026-09-25", reference), 3); // native picker format
assert.equal(leadAgeInDays("2026-09-26T10:30:00.000Z", reference), 2); // created_at
assert.equal(leadAgeInDays("-", reference), null);
assert.equal(leadAgeInDays("not a date", reference), null);

assert.equal(relativeLeadAge("28/09/2026", reference), "Added today");
assert.equal(relativeLeadAge("27/09/2026", reference), "Added yesterday");
assert.equal(relativeLeadAge("23/09/2026", reference), "Added 5 days ago");
assert.equal(relativeLeadAge("21/09/2026", reference), "Added 1 week ago");
assert.equal(relativeLeadAge("14/09/2026", reference), "Added 2 weeks ago");
assert.equal(relativeLeadAge("07/09/2026", reference), "Added 3 weeks ago");
assert.equal(relativeLeadAge("25/08/2026", reference), "Added 1 month ago");
assert.equal(relativeLeadAge("28/06/2026", reference), "Added 3 months ago");
assert.equal(relativeLeadAge("28/09/2025", reference), "Added 1 year ago");
assert.equal(relativeLeadAge("2026-09-25", reference), "Added 3 days ago");
assert.equal(relativeLeadAge("2026-09-30", reference), "In 2 days");
assert.equal(relativeLeadAge("-", reference), null);

assert.equal(shortLeadAge("28/09/2026", reference), "today");
assert.equal(shortLeadAge("27/09/2026", reference), "yest.");
assert.equal(shortLeadAge("25/09/2026", reference), "3d ago");
assert.equal(shortLeadAge("21/09/2026", reference), "1w ago");
assert.equal(shortLeadAge("-", reference), null);

assert.equal(isNewLead("28/09/2026", reference), true);
assert.equal(isNewLead("26/09/2026", reference), true);
assert.equal(isNewLead("25/09/2026", reference), false);
assert.equal(isNewLead("-", reference), false);

// ---------------------------------------------------------------------------
// 7. Treatment tally — one count per treatment for the current selection.
// ---------------------------------------------------------------------------
function tallyRow(partial: Partial<AnalyticsLead> & { id: string }): AnalyticsLead {
  return {
    name: "",
    city: "",
    disease: "",
    treatment: "",
    source: "",
    status: "New",
    assigned_to: "",
    lead_date: "28/09/2026",
    ...partial,
  };
}

const tallyRows = [
  tallyRow({ id: "1", name: "A", city: "Mumbai", disease: "LASIK", treatment: "LASIK" }),
  tallyRow({
    id: "2",
    name: "B",
    city: "Mumbai",
    disease: "Catract",
    treatment: "Cataract",
    status: "Consultation Booked",
    lead_date: "20/09/2026",
  }),
  tallyRow({ id: "3", name: "C", city: "Pune", disease: "lasik", treatment: "LASIK", status: "New" }),
  tallyRow({ id: "4", name: "D", city: "Pune", disease: "-", treatment: "-", status: "New" }),
];

assert.deepEqual(
  tallyTreatments(tallyRows, EMPTY_LEAD_FILTERS, reference).map((tally) => [tally.key, tally.count]),
  [
    ["lasik", 2],
    ["cataract", 1],
    ["unrecorded", 1], // always last — a data-quality hint, not a first click
  ],
);
assert.deepEqual(
  tallyTreatments(tallyRows, { ...EMPTY_LEAD_FILTERS, city: "Mumbai" }, reference).map(
    (tally) => [tally.key, tally.count],
  ),
  [
    ["cataract", 1],
    ["lasik", 1],
  ],
);
assert.deepEqual(
  tallyTreatments(tallyRows, { ...EMPTY_LEAD_FILTERS, stage: "booked" }, reference).map(
    (tally) => [tally.key, tally.count],
  ),
  [["cataract", 1]],
);

console.log("✓ all lead filter assertions passed");
console.log(`  href round trip: ${href}`);
console.log(`  chips: ${describeActiveFilters(parsed).join(" · ")}`);
console.log(`  age buckets: ${AGE_BUCKETS.map((bucket) => bucket.key).join(" → ")}`);

// ---------------------------------------------------------------------------
// 5. Board invariant: dropping a card into a column writes a status that
//    `stageForStatus` re-reads into the SAME stage — the card can never look
//    moved and then jump back on the next board load.
// ---------------------------------------------------------------------------
const boardStages: StageKey[] = ["new", "contacted", "booked", "attended", "surgery", "lost"];
for (const key of boardStages) {
  assert.equal(
    stageForStatus(STAGE_TARGET_STATUS[key]),
    key,
    `STAGE_TARGET_STATUS.${key} ("${STAGE_TARGET_STATUS[key]}") must re-read as stage "${key}"`,
  );
}
console.log(`  board round trip: ${boardStages.map((key) => `${key}→"${STAGE_TARGET_STATUS[key]}"→${key}`).join("  ")}`);
