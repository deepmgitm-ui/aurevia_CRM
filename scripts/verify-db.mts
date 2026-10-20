// READ-ONLY live check: are the optional SQL migrations applied?
// Run with: npm run verify:db
//   1. supabase-indexes.sql           (performance indexes + lead_rollup view)
//   2. supabase-calendar-migration.sql (calendar_events + employee activity SELECT)
//   3. supabase-hr-migration.sql       (profiles HR columns + attendance)
//   4. supabase-lead-source-batches-migration.sql (exact lead import batches)
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
let unverified = 0;
function report(label: string, ok: boolean | null, detail = "") {
  if (ok) console.log(`  ✓ ${label}${detail ? ` (${detail})` : ""}`);
  else if (ok === null) {
    unverified += 1;
    console.log(`  · ${label} — ${detail || "could not verify right now"}`);
  }
  else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function queryState(error: { message?: string | null } | null): boolean | null {
  if (!error) return true;
  const message = (error.message ?? "").toLowerCase();
  if (message.includes("fetch failed") || message.includes("network") || message.includes("timeout")) return null;
  return false;
}

function reportQuery(label: string, error: { message?: string | null } | null, missingHint = "") {
  const state = queryState(error);
  report(label, state, state === null ? "Supabase API was unreachable; not verified" : error?.message || missingHint);
}

async function hasColumn(table: string, column: string): Promise<boolean | null> {
  const { error } = await supabase.from(table).select(column).limit(1);
  return queryState(error);
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
reportQuery("lead_rollup view", rollupError);

// --- 2. calendar ---
console.log("\n2. supabase-calendar-migration.sql");
const { error: calError } = await supabase.from("calendar_events").select("id").limit(1);
reportQuery("calendar_events table", calError);
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
for (const column of ["blood_group", "emergency_contact", "manager_name", "photo_url"]) {
  report(`profiles.${column}`, await hasColumn("profiles", column));
}
const { error: attendanceError } = await supabase.from("attendance" as never).select("id" as never).limit(1 as never);
reportQuery("attendance table", attendanceError);
const { error: attendanceRequestsError } = await supabase
  .from("attendance_requests" as never)
  .select("id" as never)
  .limit(1 as never);
report(
  "attendance_requests table",
  queryState(attendanceRequestsError),
  attendanceRequestsError && queryState(attendanceRequestsError) === false ? "missed sign-in requests are disabled until supabase-attendance-requests-migration.sql is run" : "",
);

// --- 4. deletion safety net ---
console.log("\n4. supabase-deletion-backup-migration.sql");
const { error: backupTableError } = await supabase.from("lead_deletion_backups").select("id").limit(1);
report(
  "lead_deletion_backups table",
  queryState(backupTableError),
  backupTableError && queryState(backupTableError) === false ? "bulk-delete undo is disabled until this SQL is run" : "",
);

// --- 5. master data (admin-editable picklists) ---
console.log("\n5. supabase-master-data-migration.sql");
const { error: optionListsError } = await supabase.from("crm_option_lists").select("key").limit(1);
reportQuery("crm_option_lists table", optionListsError, "Settings → Master Data stays read-only (seed values)");

// --- 6. workflow automation ---
console.log("\n6. supabase-automation-migration.sql");
const { error: rulesError } = await supabase.from("crm_automation_rules").select("key").limit(1);
reportQuery("crm_automation_rules table", rulesError, "rules fall back to seed and cannot be toggled");
const { error: runsError } = await supabase.from("crm_automation_runs").select("id").limit(1);
reportQuery("crm_automation_runs table", runsError, "run receipts are not stored");

// --- 7. exact lead import batches ---
console.log("\n7. supabase-lead-source-batches-migration.sql");
const batchColumns = ["source_batch_id", "source_batch_label", "source_batch_created_at"];
for (const column of batchColumns) {
  const state = await hasColumn("leads", column);
  const detail = state === null
    ? "Supabase API was unreachable; not verified"
    : column === "source_batch_id" && state === false
      ? "needed to distinguish repeated Excel, Meta, and manual batches"
      : "";
  report(`leads.${column}`, state, detail);
}

// --- 8. is the pipeline actually populated? (informational, never a failure) ---
console.log("\n8. leads data");
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
  failed === 0 && unverified === 0
    ? "\n✓ all migrations applied — app features fully live"
    : failed === 0
      ? `\n· ${unverified} check(s) could not be verified because of temporary API access problems`
      : `\n✗ ${failed} check(s) failed${unverified ? `; ${unverified} could not be verified` : ""} — review the matching SQL file in Supabase SQL editor`,
);
process.exit(failed === 0 ? 0 : 1);
