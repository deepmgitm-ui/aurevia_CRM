import assert from "node:assert/strict";
import { applyDailyWorkFilter, assignmentDayWindow, isWorkDate } from "../lib/daily-work.ts";
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
    const alternatives = expression.split(",").map(part => part.split(".eq."));
    this.predicates.push(row => alternatives.some(([column, value]) => row[column] === value));
    return this;
  }
  matches(row: Row) { return this.predicates.every(predicate => predicate(row)); }
}
const rows: Row[] = [
  { id: "old-created-newly-assigned", created_at: "2020-01-01", assigned_at: "2026-10-10T18:30:00.000Z", status: "Contacted", opd_booked_date: "2026-10-11", opd_done_date: "2026-10-11", ipd_done_date: "2026-10-12" },
  { id: "yesterday", assigned_at: "2026-10-10T18:29:59.999Z", opd_booked_date: "2026-10-10", opd_done_date: null, ipd_done_date: "2026-10-11" },
  { id: "tomorrow", assigned_at: "2026-10-11T18:30:00.000Z", opd_booked_date: "2026-10-12", opd_done_date: null, ipd_done_date: null },
  { id: "unknown-history", assigned_at: null, opd_booked_date: null, opd_done_date: null, ipd_done_date: null },
];
for (const [kind, expected] of [["assigned", "old-created-newly-assigned"], ["opd", "old-created-newly-assigned"], ["ipd", "yesterday"]] as const) {
  const query = applyDailyWorkFilter(new Query(), kind, "2026-10-11");
  assert.deepEqual(rows.filter(row => query.matches(row)).map(row => row.id), [expected]);
  const filters = parseLeadFilters({ work: kind, day: "2026-10-11" });
  const url = new URL(leadsHref(filters), "https://crm.test");
  assert.deepEqual(parseLeadFilters(Object.fromEntries(url.searchParams)), filters);
  assert.equal(hasLeadFilters(filters), true);
  assert.ok(describeActiveFilters(filters).some(label => label.includes("2026-10-11")));
}
assert.equal(parseLeadFilters({ work: "assigned", day: "2026-02-30" }).work, "");
console.log("✓ daily work: IST boundaries, assignment date, OPD deduplication, IPD dates and filter round trips passed");
