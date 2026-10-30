import assert from "node:assert/strict";
import { estimateCapacityYears } from "../lib/capacity-estimate.ts";

assert.equal(estimateCapacityYears({ databaseBytes: 0, leadBytes: 0, activityBytes: 0, assignmentBytes: 0, leads: 0 }), null);
const estimate = estimateCapacityYears({ databaseBytes: 100 * 1024 * 1024, leadBytes: 1000 * 1024, activityBytes: 0, assignmentBytes: 0, leads: 1000 });
assert.ok(estimate);
assert.equal(estimate.bytesPerLead, 1024);
assert.ok(Math.abs(estimate.upperYears - (400 * 1024 * 1024) / (1024 * 100 * 365)) < 0.001);
assert.equal(estimate.lowerYears, estimate.upperYears / 3);
assert.equal(estimateCapacityYears({ databaseBytes: 600 * 1024 * 1024, leadBytes: 1024000, activityBytes: 0, assignmentBytes: 0, leads: 1000 })?.upperYears, 0);
console.log("Capacity estimate calculations passed");
