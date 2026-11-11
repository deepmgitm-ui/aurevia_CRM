import assert from "node:assert/strict";
import { applyAssignmentDayFilter, applyDailyFreshLeadFilter, applyUntouchedNewLeadFilter, clinicDayBounds, assignmentDayWindow, isWorkDate, isValidTaskPageRequest, leadWorkflowLabel } from "../lib/daily-work.ts";
import { clinicDate } from "../lib/attendance.ts";
import { parseLeadFilters, leadsHref, hasLeadFilters, describeActiveFilters } from "../app/dashboard/lead-filters.ts";

assert.equal(clinicDate(new Date("2026-10-10T18:29:59Z")), "2026-10-10");
assert.equal(clinicDate(new Date("2026-10-10T18:30:00Z")), "2026-10-11");
assert.deepEqual(assignmentDayWindow("2026-10-11"), { from: "2026-10-10T18:30:00.000Z", to: "2026-10-11T18:30:00.000Z" });
assert.equal(isWorkDate("2026-02-30"), false);
assert.equal(isWorkDate("2028-02-29"), true);
assert.equal(isValidTaskPageRequest("today", "patient", 1), true);
for (const invalid of [["invalid", "", 1], ["all", null, 1], ["all", "", 1.5], ["all", "", 100_001]]) {
  assert.equal(isValidTaskPageRequest(invalid[0], invalid[1], invalid[2]), false, `Invalid task query is rejected: ${invalid}`);
}

type Row = Record<string, string | null>;
class Query {
  predicates: ((row: Row) => boolean)[] = [];
  gte(column: string, value: string) { this.predicates.push(row => row[column] !== null && (row[column] ?? "") >= value); return this; }
  lt(column: string, value: string) { this.predicates.push(row => row[column] !== null && (row[column] ?? "") < value); return this; }
  eq(column: string, value: string) { this.predicates.push(row => row[column] === value); return this; }
  matches(row: Row) { return this.predicates.every(predicate => predicate(row)); }
}
const rows: Row[] = [
  { id: "old-created-newly-assigned", assigned_at: "2026-10-10T18:30:00.000Z" },
  { id: "yesterday", assigned_at: "2026-10-10T18:29:59.999Z" },
  { id: "tomorrow", assigned_at: "2026-10-11T18:30:00.000Z" },
  { id: "unknown-history", assigned_at: null },
];
{
  const query = applyAssignmentDayFilter(new Query(), "2026-10-11");
  assert.deepEqual(rows.filter(row => query.matches(row)).map(row => row.id), ["old-created-newly-assigned"]);
  const kind = "assigned" as const;
  const filters = parseLeadFilters({ work: kind, day: "2026-10-11" });
  const url = new URL(leadsHref(filters), "https://crm.test");
  assert.deepEqual(parseLeadFilters(Object.fromEntries(url.searchParams)), filters);
  assert.equal(hasLeadFilters(filters), true);
  assert.ok(describeActiveFilters(filters).some(label => label.includes("2026-10-11")));
}
assert.equal(parseLeadFilters({ work: "assigned", day: "2026-02-30" }).work, "");
const now = new Date("2026-10-11T18:30:00.000Z"); // 12 Oct, exactly midnight in India
assert.deepEqual(clinicDayBounds(now), { from: "2026-10-11T18:30:00.000Z", to: "2026-10-12T18:30:00.000Z" });
const freshTodayFilter = applyDailyFreshLeadFilter(new Query(), now);
const untouchedNewFilter = applyUntouchedNewLeadFilter(new Query(), now);
const bucketRows: Row[] = [
  { id: "today-exactly-midnight", fresh_pending_since: "2026-10-11T18:30:00.000Z", workflow_bucket: "fresh" },
  { id: "today-after-midnight", fresh_pending_since: "2026-10-11T18:31:00.000Z", workflow_bucket: "fresh" },
  { id: "previous-day-last-millisecond", fresh_pending_since: "2026-10-11T18:29:59.999Z", workflow_bucket: "fresh" },
  { id: "older-untouched", fresh_pending_since: "2026-10-10T18:30:00.000Z", workflow_bucket: "fresh" },
  { id: "reassigned-but-old-intake", assigned_fresh_since: "2026-10-11T18:00:00.000Z", fresh_pending_since: "2026-10-10T18:29:00.000Z", workflow_bucket: "fresh" },
  { id: "today-touched", fresh_pending_since: "2026-10-11T18:40:00.000Z", workflow_bucket: "followup" },
  { id: "unassigned-today", assigned_to: "-", fresh_pending_since: "2026-10-11T18:40:00.000Z", workflow_bucket: "fresh" },
  { id: "unassigned-older", assigned_to: "-", fresh_pending_since: "2026-10-11T18:29:00.000Z", workflow_bucket: "fresh" },
];
assert.deepEqual(bucketRows.filter(row => freshTodayFilter.matches(row)).map(row => row.id), ["today-exactly-midnight", "today-after-midnight", "unassigned-today"]);
assert.deepEqual(bucketRows.filter(row => untouchedNewFilter.matches(row)).map(row => row.id), ["previous-day-last-millisecond", "older-untouched", "reassigned-but-old-intake", "unassigned-older"]);
assert.equal(leadWorkflowLabel({ workflow_bucket: "fresh", fresh_pending_since: "2026-10-11T18:31:00.000Z", assigned_to: "Agent A", status: "New" }, now), "Fresh");
for (const status of ["Follow-Up", "DNP", "OPD Booked", "Dropped"]) {
  assert.equal(leadWorkflowLabel({ workflow_bucket: "fresh", fresh_pending_since: "2026-10-11T18:31:00.000Z", assigned_to: "Agent A", status }, now), "Fresh", `Today's untouched ${status} imports should retain the Fresh bucket`);
  assert.equal(leadWorkflowLabel({ workflow_bucket: "fresh", fresh_pending_since: "2026-10-10T18:31:00.000Z", assigned_to: "Agent A", status }, now), "New", `Earlier untouched ${status} should be New`);
}
assert.equal(leadWorkflowLabel({ workflow_bucket: "fresh", fresh_pending_since: "2026-10-11T18:29:59.999Z", assigned_to: "Agent A", status: "New" }, now), "New");
assert.equal(leadWorkflowLabel({ workflow_bucket: "followup", assigned_fresh_since: "2026-10-10T18:31:00.000Z", assigned_to: "Agent A", status: "New" }, now), "Follow-up");
assert.equal(leadWorkflowLabel({ workflow_bucket: "followup", assigned_fresh_since: "2026-10-10T18:31:00.000Z", assigned_to: "Agent A", status: "DNP" }, now), "DNP");
const statusFilters = parseLeadFilters({ work: "assigned", day: "2026-10-11", status: "OPD Booked" });
const statusUrl = new URL(leadsHref(statusFilters), "https://crm.test");
assert.deepEqual(parseLeadFilters(Object.fromEntries(statusUrl.searchParams)), statusFilters);
console.log("✓ daily work: IST boundaries, assignment dates, New/Fresh buckets and filter round trips passed");
