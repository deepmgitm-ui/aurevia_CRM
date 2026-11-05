// Live health check: does the deployed database actually support every feature
// the app assumes? Run with: node scripts/audit-db.mts
//
// verify-db.mts checks whether the migration FILES were applied. This checks
// the things that actually break the product: columns added after that script
// was written, RLS policies that lock everyone out, and data that quietly
// corrupts every chart.
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { canonicalTreatment, stageForStatus } from "../app/dashboard/overview/analytics.ts";

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

let problems = 0;
function ok(label: string, pass: boolean, detail = "") {
  if (!pass) problems += 1;
  console.log(`  ${pass ? "OK  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  // Profiles are needed by more than one check, so they load once and the
  // audit can report aggregate ownership checks without exposing names.
  const { data: profileRows } = await supabase.from("profiles").select("id, name, role");
  const people = (profileRows ?? []) as { id: string; name: string; role: string }[];

  console.log("=== 1. Attendance columns added AFTER verify-db was written ===");
  // probeOneColumn: a 42703 means the column is missing.
  const probe = async (table: string, column: string): Promise<boolean> => {
    const { error } = await supabase.from(table).select(column).limit(1);
    return !error;
  };
  ok("attendance.check_in_at", await probe("attendance", "check_in_at"));
  ok("attendance.check_out_at", await probe("attendance", "check_out_at"));
  ok("attendance.auto_marked", await probe("attendance", "auto_marked"));

  console.log("\n=== 2. Attendance rows actually being written ===");
  const { data: att, error: attendanceReadError } = await supabase
    .from("attendance")
    .select("auto_marked, check_in_at, marked_by");
  if (attendanceReadError) throw new Error(`Attendance audit query failed: ${attendanceReadError.message}`);
  const attRows = (att ?? []) as Record<string, string | boolean | null>[];
  ok("attendance has rows", attRows.length > 0, `${attRows.length} rows`);
  // Only an AUTO mark can have a sign-in time. A row an admin added by hand from
  // the attendance calendar has none by design — flagging those as broken would
  // send someone hunting a bug that is not there.
  const autoRows = attRows.filter((row) => row.auto_marked === true);
  const manualRows = attRows.filter((row) => row.auto_marked !== true);
  ok(
    "every automatic check-in recorded its time",
    autoRows.length === 0 || autoRows.every((row) => Boolean(row.check_in_at)),
    `${autoRows.length} automatic, ${manualRows.length} manual`,
  );
  ok(
    "every manual mark records who made it",
    manualRows.length === 0 || manualRows.every((row) => Boolean(row.marked_by)),
    `${manualRows.filter((row) => !row.marked_by).length} without marked_by`,
  );

  console.log("  INFO  attendance row details are omitted (privacy-safe summary only)");

  console.log("\n=== 3. Profiles / roles ===");
  console.log(`  people: ${people.length}`);
  for (const role of ["admin", "manager", "employee"]) {
    console.log(`    ${role}: ${people.filter((p) => p.role === role).length}`);
  }
  ok("at least one admin/manager exists", people.some((p) => p.role === "admin" || p.role === "manager"));

  console.log("\n=== 4. Data quality (what breaks charts) ===");
  const rows: Record<string, string | null>[] = [];
  const leadPageSize = 1000;
  for (let offset = 0; ; offset += leadPageSize) {
    const { data: page, error } = await supabase
      .from("leads")
      .select("id, phone, city, disease, source, status, assigned_to, lead_date, created_at")
      .order("id", { ascending: true })
      .range(offset, offset + leadPageSize - 1);
    if (error) throw new Error(`Lead audit query failed at row ${offset}: ${error.message}`);
    rows.push(...((page ?? []) as Record<string, string | null>[]));
    if (!page || page.length < leadPageSize) break;
  }
  const { count: exactLeadCount, error: exactCountError } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true });
  if (exactCountError) throw new Error(`Lead count query failed: ${exactCountError.message}`);
  ok("all lead pages loaded", rows.length === (exactLeadCount ?? 0), `${rows.length} of ${exactLeadCount ?? "?"}`);
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const count = (pick: (row: Record<string, string | null>) => string) => {
    const map = new Map<string, number>();
    for (const row of rows) {
      const key = pick(row);
      if (key) map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map].sort((a, b) => b[1] - a[1]);
  };

  const noPhone = rows.filter((r) => !text(r.phone)).length;
  const noDate = rows.filter((r) => !text(r.lead_date)).length;
  const noDisease = rows.filter((r) => !text(r.disease)).length;
  ok("every lead has a phone", noPhone === 0, `${noPhone} missing`);
  ok("every lead has a lead_date", noDate === 0, `${noDate} missing`);
  console.log(`  INFO  leads with no treatment/disease: ${noDisease}`);

  console.log(`  INFO  distinct treatment, city and source values: ${count((r) => text(r.disease)).length}, ${count((r) => text(r.city)).length}, ${count((r) => text(r.source)).length}`);

  console.log("\n=== 5. Assigned agents vs real people ===");
  const assigned = new Set(
    rows.map((r) => text(r.assigned_to)).filter((v) => v && v !== "-"),
  );
  const names = new Set(people.map((p) => text(p.name)));
  const ghosts = [...assigned].filter((a) => !names.has(a));
  ok("every assigned_to is a real profile", ghosts.length === 0, `${ghosts.length} unmatched assignment names`);
  const unassigned = rows.filter((r) => !text(r.assigned_to) || text(r.assigned_to) === "-").length;
  console.log(`  INFO  unassigned leads: ${unassigned}/${rows.length}`);

  // A status nobody types perfectly is a silent pipeline bug: stageForStatus()
  // has typo-tolerance patterns, and a misspelling that misses them drops the
  // lead into "New" — inflating the top of the funnel and hiding the loss.
  console.log("\n=== 6. Every status through the pipeline classifier ===");
  const DEAD_END = /(lost|drop|cancel|not interested|intrested|not reach|refus|invalid|junk|dead|budget|location|non[ -]?surg)/i;
  const statuses = count((r) => text(r.status));
  const misfiled: string[] = [];
  for (const [value, n] of statuses) {
    const stage = stageForStatus(value);
    if (DEAD_END.test(value) && stage !== "lost") {
      misfiled.push(`${value} (${n} leads) → counted as "${stage}"`);
    }
  }
  ok("no dead-end status is misfiled as an open stage", misfiled.length === 0);
  for (const line of misfiled) console.log(`    ${line}`);

  console.log("\n  stage distribution of the real statuses:");
  const stageMap = new Map<string, number>();
  for (const [value, n] of statuses) {
    const stage = stageForStatus(value);
    stageMap.set(stage, (stageMap.get(stage) ?? 0) + n);
  }
  for (const [stage, n] of [...stageMap].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${stage.padEnd(12)} ${n}`);
  }

  // Match the dashboard's canonicalizer so harmless case/spelling variants
  // that already share a chart bucket do not become false audit failures.
  console.log("\n=== 7. Treatment grouping ===");
  const rawTreatments = count((r) => text(r.disease)).filter(([value]) => value && value !== "-");
  const treatmentBuckets = new Map<string, number>();
  for (const [value] of rawTreatments) {
    const key = canonicalTreatment(value).key;
    treatmentBuckets.set(key, (treatmentBuckets.get(key) ?? 0) + 1);
  }
  const normalizedVariants = [...treatmentBuckets.values()].filter((variants) => variants > 1).length;
  console.log(`  INFO  ${normalizedVariants} canonical groups merge multiple source spellings; raw values are omitted`);

  // Duplicate numbers break the Meta dedupe and double-count a person.
  console.log("\n=== 8. Duplicate phone numbers ===");
  const phones = new Map<string, number>();
  for (const row of rows) {
    const digits = text(row.phone).replace(/\D/g, "");
    const phone = digits.length >= 10 ? digits.slice(-10) : "";
    if (phone) phones.set(phone, (phones.get(phone) ?? 0) + 1);
  }
  const dupes = [...phones].filter(([, n]) => n > 1);
  ok("no duplicate normalized phone numbers", dupes.length === 0, `${dupes.length} duplicate groups; phone values are omitted`);

  // The timeline is a real feature; zero rows means nobody has logged a call.
  const { count: activityCount } = await supabase
    .from("lead_activities")
    .select("id", { count: "exact", head: true });
  console.log(`\n=== 10. Activity timeline ===\n  lead_activities rows: ${activityCount ?? "?"}`);
  if ((activityCount ?? 0) === 0) {
    console.log("  INFO  empty — no call/note has been logged yet (timeline renders empty)");
  }

  console.log(`\n=== RESULT: ${problems} problem(s) ===`);
}

// Wrapped in main() so the process does not exit with the Supabase socket open.
await main();
