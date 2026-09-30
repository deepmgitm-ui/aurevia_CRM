// READ-ONLY diagnostic: what does the admin Overview dashboard render for the
// leads that are really in the database right now?
// Run with: node scripts/diagnose-dashboard.mts
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

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
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error("Supabase URL / key missing in .env.local");

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const {
  applyFilters,
  buildDashboardMetrics,
  collectFilterOptions,
  currentQuarterRange,
  effectiveRange,
  emptyFilters,
  parseLeadDateText,
  toAnalyticsLead,
  toIsoDate,
} = await import("../app/dashboard/overview/analytics.ts");

const { data, error } = await supabase.from("leads").select("*").limit(5000);
if (error) throw new Error(error.message);
const rows = (data ?? []).map((row) => toAnalyticsLead(row as never));
console.log(`leads in database: ${rows.length}`);

function tally(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const clean = String(value ?? "").trim() || "(empty)";
    counts.set(clean, (counts.get(clean) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function printTally(label: string, values: string[], limit = 8) {
  const entries = tally(values);
  console.log(`\n--- ${label} (${entries.length} distinct) ---`);
  for (const [value, count] of entries.slice(0, limit)) console.log(`  ${String(count).padStart(4)}  ${value}`);
  if (entries.length > limit) console.log(`  ... +${entries.length - limit} more`);
}

printTally("status", rows.map((row) => row.status));
printTally("temperature", rows.map((row) => row.temperature));
printTally("assigned_to", rows.map((row) => row.assigned_to));
printTally("source", rows.map((row) => row.source));
printTally("city", rows.map((row) => row.city), 6);
printTally("treatment", rows.map((row) => row.treatment), 6);

// Lead dates: how many parse, and where do they sit?
const parsed = rows.map((row) => ({ raw: row.lead_date, date: parseLeadDateText(row.lead_date) }));
const unparsed = parsed.filter((entry) => !entry.date);
const dated = parsed.filter((entry) => entry.date).map((entry) => entry.date as Date).sort((a, b) => a.getTime() - b.getTime());
console.log(`\n--- lead_date ---`);
console.log(`  parseable: ${dated.length}/${rows.length}${unparsed.length ? ` | UNPARSEABLE: ${unparsed.length}` : ""}`);
console.log(`  samples: ${parsed.slice(0, 6).map((entry) => entry.raw).join(" | ")}`);
if (unparsed.length) console.log(`  unparsed samples: ${unparsed.slice(0, 6).map((entry) => entry.raw).join(" | ")}`);
if (dated.length) console.log(`  earliest: ${toIsoDate(dated[0])} | latest: ${toIsoDate(dated[dated.length - 1])}`);

const range = currentQuarterRange();
console.log(`\n=== default dashboard window (current quarter): ${range.from} → ${range.to} ===`);
const filters = emptyFilters(range);
const filtered = applyFilters(rows, filters);
console.log(`  rows after the default filters: ${filtered.length}/${rows.length}`);
const inWindow = rows.filter((row) => {
  const date = parseLeadDateText(row.lead_date);
  if (!date) return true;
  return toIsoDate(date) >= range.from && toIsoDate(date) <= range.to;
});
console.log(`  rows whose lead_date is inside the window (plus undated): ${inWindow.length}`);

function report(label: string, subset: typeof rows, window: { from: string; to: string }) {
  const metrics = buildDashboardMetrics(subset, [], window);
  console.log(`\n=== ${label} (${subset.length} rows, window ${window.from} → ${window.to}) ===`);
  console.log(`  isSample fallback would trigger: ${rows.length === 0}`);
  for (const kpi of metrics.kpis) console.log(`  ${kpi.label.padEnd(26)} ${kpi.value}`);
  const stageLine = metrics.pipeline
    .map((row) => `${row.stage}=${row.total}`)
    .join("  ");
  console.log(`  pipeline: ${stageLine}`);
  console.log(`  treatments: ${metrics.treatmentSeries.map((entry) => `${entry.label}(${entry.total})`).join(", ")}`);
  console.log(`  cities: ${metrics.cities.slice(0, 5).map((city) => `${city.label}(${city.value})`).join(", ") || "—"}`);
  console.log(`  sources: ${metrics.sources.slice(0, 5).map((source) => `${source.label}(${source.value})`).join(", ") || "—"}`);
  console.log(`  trend months: ${metrics.trend.map((point) => `${point.month}=${point.leads}`).join(", ")}`);
  console.log(`  agents: ${metrics.agents.map((agent) => `${agent.name}(total=${agent.total},won=${agent.won})`).join(", ") || "—"}`);
}

report("REAL dashboard render (default quarter window)", filtered, effectiveRange(range, filters));
report("Dashboard with the SAME rows but all-time window", rows, { from: "2000-01-01", to: "2100-12-31" });

const options = collectFilterOptions(rows);
console.log(`\n--- filter dropdown options (real data) ---`);
console.log(`  cities: ${options.cities.join(", ") || "—"}`);
console.log(`  sources: ${options.sources.join(", ") || "—"}`);
console.log(`  treatments: ${options.treatments.join(", ") || "—"}`);
console.log(`  agents: ${options.agents.join(", ") || "—"}`);
