// Live check: do the analysis tabs see the leads now?
// Run with: node scripts/check-section-window.mts
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import {
  filterLeadsByRange,
  parseLeadDateText,
  resolveDashboardWindow,
  toAnalyticsLead,
} from "../app/dashboard/overview/analytics.ts";
import { monthFilterLabel } from "../app/dashboard/lead-filters.ts";
import { stageForStatus } from "../app/dashboard/overview/analytics.ts";

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) env[match[1]] = match[2].trim();
  }
  return env;
}

const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function main() {
  const { data, error } = await supabase
    .from("leads")
    .select("id, name, city, disease, source, status, temperature, assigned_to, lead_date, created_at");
  if (error) throw new Error(error.message);

const allRows = (data ?? []).map(toAnalyticsLead);
const { range, note } = resolveDashboardWindow({}, allRows);
const rows = filterLeadsByRange(allRows, range);

console.log(`leads in database : ${allRows.length}`);
console.log(`window opened on  : ${range.from} → ${range.to}`);
console.log(`note shown        : ${note ? "yes (amber banner)" : "no"}`);
console.log(`leads in window   : ${rows.length}`);

const stages = ["booked", "attended", "surgery", "new", "contacted", "lost"] as const;
for (const stage of stages) {
  const count = rows.filter((row) => stageForStatus(row.status) === stage).length;
  console.log(`  ${stage.padEnd(10)}: ${count}`);
}

// The month picker must only offer months that really hold leads — a dropdown
// entry that returns nothing is worse than no entry at all.
const months = new Map<string, number>();
for (const row of allRows) {
  const date = parseLeadDateText(row.lead_date);
  if (!date) continue;
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  months.set(key, (months.get(key) ?? 0) + 1);
}
console.log("\nmonth picker will offer:");
for (const [key, count] of [...months].sort((a, b) => b[0].localeCompare(a[0]))) {
  console.log(`  ${key} (${monthFilterLabel(key)}) → ${count} leads`);
}
}

// Wrapped in main() rather than left at the top level: killing the process with
// the Supabase socket still open trips a libuv assertion on Windows.
await main();
