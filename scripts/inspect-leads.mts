// READ-ONLY diagnostic: which column actually holds the treatment / disease text?
// Run with: node scripts/inspect-leads.mts
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

const supabase = createClient(url, key, { auth: { persistSession: false } });

// select("*") here is intentional: this is a one-off schema/value probe, not the
// analytics path.
const { data, error } = await supabase.from("leads").select("*").limit(1000);
if (error) throw new Error(error.message);

const rows = data ?? [];
console.log(`rows fetched: ${rows.length}`);
if (rows.length === 0) process.exit(0);

console.log("\ncolumns present:", Object.keys(rows[0]).join(", "));

const candidates = [
  "treatment_type",
  "treatment",
  "treatment_name",
  "surgery_type",
  "surgery",
  "procedure",
  "disease",
  "diagnosis",
  "remarks",
  "status",
];

console.log("\n--- non-empty / distinct counts per candidate column ---");
for (const column of candidates) {
  const values = rows
    .map((row) => (row as Record<string, unknown>)[column])
    .filter((value): value is string => typeof value === "string" && value.trim() !== "" && value.trim() !== "-");
  const top = new Map<string, number>();
  for (const value of values) {
    const clean = value.trim();
    top.set(clean, (top.get(clean) ?? 0) + 1);
  }
  const summary =
    [...top.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([label, count]) => `${label}(${count})`)
      .join(", ") || "— empty —";
  const exists = column in rows[0] ? "" : "  [COLUMN DOES NOT EXIST]";
  console.log(`${column.padEnd(16)} filled=${String(values.length).padStart(4)}${exists}\n    ${summary}`);
}

console.log("\n--- first 3 rows (name / status / treatment-ish fields) ---");
for (const row of rows.slice(0, 3)) {
  const record = row as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const column of Object.keys(record)) {
    const value = record[column];
    if (typeof value === "string" && value.trim() && value.trim() !== "-") picked[column] = value.slice(0, 60);
  }
  console.log(JSON.stringify(picked));
}

// ---------------------------------------------------------------------------
// Where does TREATMENT text actually appear anywhere in the row?
// ---------------------------------------------------------------------------
const KEYWORDS = [
  "lasik", "lasic", "lacek", "laser", "smile", "contoura", "prk", "refract",
  "cataract", "catract", "motiyabind", "motia", "phaco", "iol", "lens",
  "icl", "implant", "phakic",
  "retina", "vitreous", "macula", "diabet",
  "squint", "keratoconus", "cross link", "crosslink", "cornea", "corneal", "glaucoma",
  "pterygium", "dcr", "dacryo", "ptosis", "oculoplasty", "chalazion", "dermoid",
  "cataract surgery", "eye surgery", "specs", "spectacle", "glasses",
];

const SCAN_COLUMNS = ["disease", "remarks", "name", "city", "status", "source", "insurance_status"];
const hits = new Map<string, Map<string, number>>();
for (const column of SCAN_COLUMNS) hits.set(column, new Map());

let rowsWithAnyKeyword = 0;
const rowExamples: string[] = [];

for (const row of rows) {
  const record = row as Record<string, unknown>;
  let rowHas = false;
  for (const column of SCAN_COLUMNS) {
    const value = typeof record[column] === "string" ? (record[column] as string).toLowerCase() : "";
    if (!value) continue;
    for (const keyword of KEYWORDS) {
      if (value.includes(keyword)) {
        const bucket = hits.get(column)!;
        bucket.set(keyword, (bucket.get(keyword) ?? 0) + 1);
        rowHas = true;
      }
    }
  }
  if (rowHas) {
    rowsWithAnyKeyword += 1;
    if (rowExamples.length < 12) {
      rowExamples.push(`${String(record.name).slice(0, 26)} | ${String(record.status)} | ${String(record.disease)} | ${String(record.remarks).slice(0, 70)}`);
    }
  }
}

console.log(`\n--- treatment keyword hits (rows with any hit: ${rowsWithAnyKeyword}/${rows.length}) ---`);
for (const [column, bucket] of hits) {
  if (bucket.size === 0) continue;
  const summary = [...bucket.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([keyword, count]) => `${keyword}(${count})`)
    .join(", ");
  console.log(`${column}: ${summary}`);
}

console.log("\n--- sample rows that mention a treatment keyword ---");
for (const example of rowExamples) console.log("  " + example);

// ---------------------------------------------------------------------------
// What the dashboard will now render for THIS data (same code path as the app).
// ---------------------------------------------------------------------------
const { buildDashboardMetrics, currentQuarterRange, stageForStatus, toAnalyticsLead } = await import(
  "../app/dashboard/overview/analytics.ts"
);

const range = currentQuarterRange();
const mapped = rows.map((row) => toAnalyticsLead(row as never));
const metrics = buildDashboardMetrics(mapped, [], range);

console.log(`\n=== Leads Pipeline by Stage (range ${range.from} → ${range.to}) ===`);
console.log("series:", metrics.treatmentSeries.map((s) => `${s.label}[${s.key}]`).join(", "));
console.log(
  `treatment coverage: ${metrics.treatmentCoverage.recorded}/${metrics.treatmentCoverage.total} funnel leads have a treatment`,
);
for (const row of metrics.pipeline) {
  const cells = row.series
    .filter((cell) => cell.value > 0)
    .map((cell) => `${cell.label}=${cell.value}`)
    .join(" | ");
  console.log(`  ${row.stage.padEnd(24)} total=${String(row.total).padStart(4)}   ${cells}`);
}

console.log("\n=== all 892 leads by stage (includes lost) ===");
const stageCounts = new Map<string, number>();
for (const row of mapped) {
  const stage = stageForStatus(row.status);
  stageCounts.set(stage, (stageCounts.get(stage) ?? 0) + 1);
}
for (const [stage, count] of [...stageCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${stage.padEnd(12)} ${count}`);
}
console.log(`\nKPIs: ${metrics.kpis.map((k) => `${k.label}=${k.value}`).join(", ")}`);


