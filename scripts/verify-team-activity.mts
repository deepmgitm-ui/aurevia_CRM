import assert from "node:assert/strict";
import {
  activityState,
  activityDuration,
  type StaffActivity,
} from "../lib/team-activity.ts";
const now = Date.parse("2026-10-12T12:00:00Z");
const row: StaffActivity = {
  user_id: "fixture",
  name: "Test",
  role: "employee",
  first_seen: null,
  last_seen: new Date(now - 60_000).toISOString(),
  last_active: new Date(now - 120_000).toISOString(),
  session_started_at: null,
  online_seconds: 120,
  active_seconds: 60,
};
assert.equal(activityState(row, now), "Active");
assert.equal(
  activityState(
    { ...row, last_active: new Date(now - 301_000).toISOString() },
    now,
  ),
  "Idle",
);
assert.equal(
  activityState(
    { ...row, last_seen: new Date(now - 151_000).toISOString() },
    now,
  ),
  "Offline",
);
assert.equal(activityState({ ...row, last_seen: null }, now), "Offline");
assert.equal(activityState({ ...row, last_seen: "invalid" }, now), "Offline");
assert.equal(activityDuration(3661), "1h 1m");
assert.equal(activityDuration(59), "< 1m");
console.log("Team activity states, boundaries and duration formatting passed.");
