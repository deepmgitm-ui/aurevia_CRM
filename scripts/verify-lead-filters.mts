// Regression checks for the drill-down lead filters + age buckets.
// Run with: npm run verify:lead-filters
import assert from "node:assert/strict";

import {
  AGE_BUCKETS,
  EMPTY_LEAD_FILTERS,
  ageBucketFor,
  ageBucketLabel,
  ageBucketWindow,
  andClauses,
  blankColumnClause,
  describeActiveFilters,
  filterChipLabels,
  hasLeadFilters,
  inListExpression,
  leadsHref,
  parseLeadFilters,
  prettifyFilterKey,
  stageFilterKeys,
  treatmentOrExpression,
  type LeadListFilters,
} from "../app/dashboard/lead-filters.ts";

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

console.log("✓ all lead filter assertions passed");
console.log(`  href round trip: ${href}`);
console.log(`  chips: ${describeActiveFilters(parsed).join(" · ")}`);
console.log(`  age buckets: ${AGE_BUCKETS.map((bucket) => bucket.key).join(" → ")}`);