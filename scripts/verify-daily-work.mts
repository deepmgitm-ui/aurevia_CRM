import assert from "node:assert/strict";
import { applyAssignmentDayFilter, applyCurrentNewLeadFilter, olderFreshLeadFilter, assignmentDayWindow, isWorkDate, leadWorkflowLabel } from "../lib/daily-work.ts";
import { clinicDate } from "../lib/attendance.ts";
import { parseLeadFilters, leadsHref, hasLeadFilters, describeActiveFilters } from "../app/dashboard/lead-filters.ts";

assert.equal(clinicDate(new Date("2026-10-10T18:29:59Z")), "2026-10-10");
assert.equal(clinicDate(new Date("2026-10-10T18:30:00Z")), "2026-10-11");
assert.deepEqual(assignmentDayWindow("2026-10-11"), { from: "2026-10-10T18:30:00.000Z", to: "2026-10-11T18:30:00.000Z" });
assert.equal(isWorkDate("2026-02-30"), false);
assert.equal(isWorkDate("2028-02-29"), true);

type Row = Record<string, string | null>;
class Query {
  predicates: ((row: Row) => boolean)[] = [];
  gte(column: string, value: string) { this.predicates.push(row => row[column] !== null && (row[column] ?? "") >= value); return this; }
  lt(column: string, value: string) { this.predicates.push(row => row[column] !== null && (row[column] ?? "") < value); return this; }
  eq(column: string, value: string) { this.predicates.push(row => row[column] === value); return this; }
  or(expression: string) {
    const olderFresh = expression.match(/^assigned_fresh_since\.lt\.([^,]+),and\(assigned_fresh_since\.is\.null,fresh_pending_since\.lt\.([^,]+)\)$/);
    if (olderFresh) {
      const [, assignedBefore, pendingBefore] = olderFresh;
      this.predicates.push(row => Boolean(
        (row.assigned_fresh_since && row.assigned_fresh_since < assignedBefore) ||
        (row.assigned_fresh_since == null && row.fresh_pending_since && row.fresh_pending_since < pendingBefore),
      ));
      return this;
    }
    const freshWindow = expression.match(/^and\(assigned_fresh_since\.gte\.([^,]+),assigned_fresh_since\.lt\.([^,]+)\),and\(fresh_pending_since\.gte\.([^,]+),fresh_pending_since\.lt\.([^,]+),or\(assigned_to\.is\.null,assigned_to\.eq\.-,assigned_to\.eq\.unassigned\)\)$/);
    if (freshWindow) {
      const [, assignedFrom, assignedTo, pendingFrom, pendingTo] = freshWindow;
      this.predicates.push(row => Boolean(
        (row.assigned_fresh_since && row.assigned_fresh_since >= assignedFrom && row.assigned_fresh_since < assignedTo) ||
        (row.fresh_pending_since && row.fresh_pending_since >= pendingFrom && row.fresh_pending_since < pendingTo && (row.assigned_to == null || row.assigned_to === "-" || row.assigned_to === "unassigned")),
      ));
      return this;
    }
    const alternatives = expression.split(",").map(part => part.split(".eq."));
    this.predicates.push(row => alternatives.some(([column, value]) => row[column] === value));
    return this;
  }
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
const currentNewFilter = applyCurrentNewLeadFilter(new Query(), "2026-10-11");
const currentNewRows: Row[] = [
  { id: "today-untouched", assigned_at: "2026-10-10T18:00:00.000Z", assigned_fresh_since: "2026-10-10T18:31:00.000Z", workflow_bucket: "fresh" },
  { id: "yesterday-untouched", assigned_at: "2026-10-10T18:00:00.000Z", assigned_fresh_since: "2026-10-10T18:29:00.000Z", workflow_bucket: "fresh" },
  { id: "today-touched", assigned_at: "2026-10-10T18:40:00.000Z", assigned_fresh_since: "2026-10-10T18:40:00.000Z", workflow_bucket: "followup" },
  { id: "today-unassigned", assigned_to: "-", fresh_pending_since: "2026-10-10T18:40:00.000Z", workflow_bucket: "fresh" },
  { id: "yesterday-unassigned", assigned_to: "-", fresh_pending_since: "2026-10-10T18:29:00.000Z", workflow_bucket: "fresh" },
];
assert.deepEqual(currentNewRows.filter(row => currentNewFilter.matches(row)).map(row => row.id), ["today-untouched", "today-unassigned"]);
const olderFreshFilter = new Query().eq("workflow_bucket", "fresh").or(olderFreshLeadFilter("2026-10-11"));
assert.deepEqual(currentNewRows.filter(row => olderFreshFilter.matches(row)).map(row => row.id), ["yesterday-untouched", "yesterday-unassigned"]);
assert.equal(leadWorkflowLabel({ workflow_bucket: "fresh", assigned_fresh_since: "2026-10-10T18:31:00.000Z", assigned_to: "Agent A", status: "New" }, "2026-10-11"), "New");
for (const status of ["Follow-Up", "DNP", "OPD Booked", "Dropped"]) {
  assert.equal(leadWorkflowLabel({ workflow_bucket: "fresh", assigned_fresh_since: "2026-10-10T18:31:00.000Z", assigned_to: "Agent A", status }, "2026-10-11"), "New", `Untouched ${status} imports should retain their workflow bucket`);
  assert.equal(leadWorkflowLabel({ workflow_bucket: "fresh", assigned_fresh_since: "2026-10-09T18:31:00.000Z", assigned_to: "Agent A", status }, "2026-10-11"), "Fresh", `Older untouched ${status} imports should be Fresh`);
}
assert.equal(leadWorkflowLabel({ workflow_bucket: "fresh", assigned_fresh_since: "2026-10-10T18:29:00.000Z", assigned_to: "Agent A", status: "New" }, "2026-10-11"), "Fresh");
assert.equal(leadWorkflowLabel({ workflow_bucket: "followup", assigned_fresh_since: "2026-10-10T18:31:00.000Z", assigned_to: "Agent A", status: "New" }, "2026-10-11"), "Follow-up");
assert.equal(leadWorkflowLabel({ workflow_bucket: "followup", assigned_fresh_since: "2026-10-10T18:31:00.000Z", assigned_to: "Agent A", status: "DNP" }, "2026-10-11"), "DNP");
const statusFilters = parseLeadFilters({ work: "assigned", day: "2026-10-11", status: "OPD Booked" });
const statusUrl = new URL(leadsHref(statusFilters), "https://crm.test");
assert.deepEqual(parseLeadFilters(Object.fromEntries(statusUrl.searchParams)), statusFilters);
console.log("✓ daily work: IST boundaries, assignment dates, New/Fresh buckets and filter round trips passed");
