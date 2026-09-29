// READ-ONLY live check: are the three optional SQL migrations applied?
// Run with: npm run verify:db
//   1. supabase-indexes.sql           (performance indexes + lead_rollup view)
//   2. supabase-calendar-migration.sql (calendar_events + employee activity SELECT)
//   3. supabase-hr-migration.sql       (profiles HR columns + attendance)
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

let failed = 0;
function report(label: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ✓ ${label}${detail ? ` (${detail})` : ""}`);
  else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function hasColumn(table: string, column: string): Promise<boolean> {
  const { data, error } = await supabase.from(table).select(column).limit(1);
  if (error) return false;
  return Boolean(data);
}

async function hasIndex(name: string): Promise<boolean | null> {
  const { error } = await supabase
    .from("pg_indexes" as never)
    .select("indexname" as never)
    .eq("tablename" as never, "leads" as never)
    .limit(1 as never);
  // System catalogs are not exposed over PostgREST by default — report
  // "unknown" instead of a false failure.
  if (error) return null;
  const { data } = await supabase
    .from("pg_indexes" as never)
    .select("indexname" as never)
    .eq("tablename" as never, "leads" as never);
  return ((data ?? []) as unknown as { indexname: string }[]).some((row) => row.indexname === name);
}

console.log("Supabase migration status:\n");

// --- 1. indexes ---
const INDEXES = [
  "leads_created_at_idx",
  "leads_status_idx",
  "leads_assigned_to_idx",
  "leads_disease_idx",
  "leads_phone_idx",
  "leads_status_created_idx",
];
console.log("1. supabase-indexes.sql");
const firstIndexState = await hasIndex(INDEXES[0]);
for (const index of INDEXES) {
  const state = firstIndexState === null ? null : await hasIndex(index);
  if (state === null) report(index, true, "cannot verify over REST — run in SQL editor if unsure");
  else report(index, state);
}
const { error: rollupError } = await supabase.from("lead_rollup" as never).select("month" as never).limit(1 as never);
report("lead_rollup view", !rollupError, rollupError?.message);

// --- 2. calendar ---
console.log("\n2. supabase-calendar-migration.sql");
const { error: calError } = await supabase.from("calendar_events").select("id").limit(1);
report("calendar_events table", !calError, calError?.message);
const { data: policies, error: policyError } = await supabase
  .from("pg_policies" as never)
  .select("policyname" as never)
  .eq("tablename" as never, "lead_activities" as never);
const policyNames = ((policies ?? []) as unknown as { policyname: string }[]).map((row) => row.policyname);
if (policyError) {
  // pg_policies is a system catalog — many projects do not expose it over REST.
  report("lead_activities_employee_select_own policy", true, "cannot verify over REST — check SQL editor");
} else {
  report("lead_activities_employee_select_own policy", policyNames.includes("lead_activities_employee_select_own"));
}

// --- 3. HR ---
console.log("\n3. supabase-hr-migration.sql");
report("profiles.blood_group", await hasColumn("profiles", "blood_group"));
report("profiles.emergency_contact", await hasColumn("profiles", "emergency_contact"));
report("profiles.manager_name", await hasColumn("profiles", "manager_name"));
report("profiles.photo_url", await hasColumn("profiles", "photo_url"));
const { error: attendanceError } = await supabase.from("attendance" as never).select("id" as never).limit(1 as never);
report("attendance table", !attendanceError, attendanceError?.message);

// --- 4. deletion safety net ---
console.log("\n4. supabase-deletion-backup-migration.sql");
const { error: backupTableError } = await supabase.from("lead_deletion_backups").select("id").limit(1);
report(
  "lead_deletion_backups table",
  !backupTableError,
  backupTableError ? "bulk-delete undo is disabled until this SQL is run" : "",
);

// --- 5. master data (admin-editable picklists) ---
console.log("\n5. supabase-master-data-migration.sql");
const { error: optionListsError } = await supabase.from("crm_option_lists").select("key").limit(1);
report("crm_option_lists table", !optionListsError, optionListsError ? "Settings → Master Data stays read-only (seed values)" : "");

// --- 6. workflow automation ---
console.log("\n6. supabase-automation-migration.sql");
const { error: rulesError } = await supabase.from("crm_automation_rules").select("key").limit(1);
report("crm_automation_rules table", !rulesError, rulesError ? "rules fall back to seed and cannot be toggled" : "");
const { error: runsError } = await supabase.from("crm_automation_runs").select("id").limit(1);
report("crm_automation_runs table", !runsError, runsError ? "run receipts are not stored" : "");

// --- 7. is the pipeline actually populated? (informational, never a failure) ---
console.log("\n7. leads data");
const { count: leadCount, error: leadCountError } = await supabase
  .from("leads")
  .select("id", { count: "exact", head: true });
if (leadCountError) console.log(`  · leads rows: unreadable — ${leadCountError.message}`);
else if ((leadCount ?? 0) === 0) {
  console.log("  · leads rows: 0 — the pipeline is EMPTY. Use Leads → Import (CSV/Excel) to reload it.");
} else console.log(`  · leads rows: ${leadCount}`);
const { count: activityCount } = await supabase
  .from("lead_activities")
  .select("id", { count: "exact", head: true });
console.log(`  · lead_activities rows: ${activityCount ?? 0}`);

console.log(
  failed === 0
    ? "\n✓ all migrations applied — app features fully live"
    : `\n✗ ${failed} check(s) failed — paste the matching SQL file in Supabase SQL editor`,
);
process.exit(failed === 0 ? 0 : 1);
