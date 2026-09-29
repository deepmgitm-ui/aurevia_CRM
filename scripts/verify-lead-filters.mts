// Regression checks for the drill-down lead filters + age buckets.
// Run with: npm run verify:lead-filters
import assert from "node:assert/strict";

import {
  AGE_BUCKETS,
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
  isNewLead,
  leadAgeInDays,
  leadsHref,
  parseLeadFilters,
  prettifyFilterKey,
  relativeLeadAge,
  shortLeadAge,
  stageFilterKeys,
  tallyTreatments,
  treatmentOrExpression,
  type LeadListFilters,
} from "../app/dashboard/lead-filters.ts";
import type { AnalyticsLead } from "../app/dashboard/overview/analytics.ts";

// ---------------------------------------------------------------------------
// 1. Round trip: a chart click link parses back to the exact same filter set.
// ---------------------------------------------------------------------------
const original: LeadListFilters = {
  q: "",
  stage: "booked,attended,surgery",
  treatment: "other",
  except: "hair,skin",
  age: "today",
  city: "Mumbai",
  source: "Meta Ads",
  assigned: "Ravi Sharma",
  status: "",
};
const href = leadsHref(original);
assert.ok(href.startsWith("/dashboard/leads?"), `unexpected href: ${href}`);
const parsed = parseLeadFilters(Object.fromEntries(new URL(`http://localhost${href}`).searchParams));
assert.deepEqual(parsed, original, "round trip must preserve every filter");

// Empty values are dropped; `except` only survives together with treatment=other.
assert.equal(leadsHref({ city: "Pune" }), "/dashboard/leads?city=Pune");
assert.equal(leadsHref({ except: "hair" }), "/dashboard/leads");
assert.equal(leadsHref(EMPTY_LEAD_FILTERS), "/dashboard/leads");

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
  "Consultation Booked",
  "Consultation Attended",
  "Surgery Completed",
  "Other",
  "Today",
  "Mumbai",
  "Meta Ads",
  "Ravi Sharma",
]);
assert.equal(prettifyFilterKey("eye-checkup"), "Eye checkup");
assert.equal(filterChipLabels().surgery, "Surgery Completed");

// ---------------------------------------------------------------------------
// 4. Age windows: bounded single/open day ranges computed server-side.
// ---------------------------------------------------------------------------
const reference = new Date(2026, 8, 28, 13, 45); // 28 Sep 2026, afternoon
assert.deepEqual(
  AGE_BUCKETS.map((bucket) => bucket.key),
  ["today", "yesterday", "d2", "d3", "d4", "d5", "d6", "w1", "w2", "w3", "older"],
);
assert.equal(ageBucketLabel("today"), "Today");
assert.equal(ageBucketLabel("weird"), "All time");

const todayWindow = ageBucketWindow("today", reference)!;
assert.equal(todayWindow.fromIso, new Date(2026, 8, 28).toISOString());
assert.equal(todayWindow.toIso, new Date(2026, 8, 29).toISOString());

const yesterdayWindow = ageBucketWindow("yesterday", reference)!;
assert.equal(yesterdayWindow.fromIso, new Date(2026, 8, 27).toISOString());
assert.equal(yesterdayWindow.toIso, new Date(2026, 8, 28).toISOString());

const weekWindow = ageBucketWindow("w1", reference)!;
assert.equal(weekWindow.fromIso, new Date(2026, 8, 15).toISOString());
assert.equal(weekWindow.toIso, new Date(2026, 8, 22).toISOString());

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
    temperature: "",
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