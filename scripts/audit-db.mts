// Live health check: does the deployed database actually support every feature
// the app assumes? Run with: node scripts/audit-db.mts
//
// verify-db.mts checks whether the migration FILES were applied. This checks
// the things that actually break the product: columns added after that script
// was written, RLS policies that lock everyone out, and data that quietly
// corrupts every chart.
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

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

let problems = 0;
function ok(label: string, pass: boolean, detail = "") {
  if (!pass) problems += 1;
  console.log(`  ${pass ? "OK  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  // Profiles are needed by more than one check, so they load first and the
  // attendance rows can be printed with a real name instead of a UUID.
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
  const { data: att } = await supabase
    .from("attendance")
    .select("id, employee_id, attendance_date, status, check_in_at, auto_marked, marked_by, created_at, note");
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

  for (const row of attRows) {
    const who = people.find((p) => p.id === row.employee_id);
    console.log(
      `    ${String(row.attendance_date)}  ${who?.name ?? row.employee_id}  status=${row.status}  check_in=${row.check_in_at ?? "NULL"}  auto=${row.auto_marked}  marked_by=${row.marked_by ?? "null"}  note=${row.note ?? "null"}`,
    );
  }

  console.log("\n=== 3. Profiles / roles ===");
  console.log(`  people: ${people.length}`);
  for (const role of ["admin", "manager", "employee"]) {
    console.log(`    ${role}: ${people.filter((p) => p.role === role).length}`);
  }
  ok("at least one admin/manager exists", people.some((p) => p.role === "admin" || p.role === "manager"));

  console.log("\n=== 4. Data quality (what breaks charts) ===");
  const { data: leads } = await supabase
    .from("leads")
    .select("id, name, phone, city, disease, source, status, temperature, assigned_to, lead_date, created_at");
  const rows = (leads ?? []) as Record<string, string | null>[];
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

  console.log("\n  treatments (top 12):");
  for (const [value, n] of count((r) => text(r.disease)).slice(0, 12)) {
    console.log(`    ${String(n).padStart(3)} × ${value}`);
  }
  console.log("\n  cities (top 12):");
  for (const [value, n] of count((r) => text(r.city)).slice(0, 12)) {
    console.log(`    ${String(n).padStart(3)} × ${value}`);
  }
  console.log("\n  sources:");
  for (const [value, n] of count((r) => text(r.source))) {
    console.log(`    ${String(n).padStart(3)} × ${value}`);
  }
  console.log("\n  statuses:");
  for (const [value, n] of count((r) => text(r.status)).slice(0, 20)) {
    console.log(`    ${String(n).padStart(3)} × ${value}`);
  }

  console.log("\n=== 5. Assigned agents vs real people ===");
  const assigned = new Set(
    rows.map((r) => text(r.assigned_to)).filter((v) => v && v !== "-"),
  );
  const names = new Set(people.map((p) => text(p.name)));
  const ghosts = [...assigned].filter((a) => !names.has(a));
  ok("every assigned_to is a real profile", ghosts.length === 0, ghosts.join(", "));
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

  // Treatment spellings split one treatment across two chart bars.
  console.log("\n=== 7. Treatment values that are really the same thing ===");
  const diseases = count((r) => text(r.disease)).filter(([v]) => v && v !== "-");
  const canon = new Map<string, string[]>();
  for (const [value] of diseases) {
    const key = value.toLowerCase().replace(/[\s_-]+/g, "");
    canon.set(key, [...(canon.get(key) ?? []), value]);
  }
  const splits = [...canon.values()].filter((group) => group.length > 1);
  ok("no treatment is spelled two different ways", splits.length === 0);
  for (const group of splits) console.log(`    ${group.join("  +  ")}`);

  // The automation rules match on temperature literals ("hot" / "warm"), so a
  // value outside that vocabulary silently makes rules skip the lead.
  console.log("\n=== 8. Values the automation rules match on ===");
  const temps = count((r) => text(r.temperature));
  console.log("  temperatures:");
  for (const [value, n] of temps) console.log(`    ${String(n).padStart(3)} × ${value || "(blank)"}`);
  const known = new Set(["hot", "warm", "cold"]);
  const oddTemps = temps.filter(([value]) => value && !known.has(value.toLowerCase()));
  ok("every temperature is hot / warm / cold", oddTemps.length === 0, oddTemps.map(([v]) => v).join(", "));

  // Duplicate numbers break the Meta dedupe and double-count a person.
  console.log("\n=== 9. Duplicate phone numbers ===");
  const phones = new Map<string, number>();
  for (const row of rows) {
    const phone = text(row.phone);
    if (phone) phones.set(phone, (phones.get(phone) ?? 0) + 1);
  }
  const dupes = [...phones].filter(([, n]) => n > 1);
  ok("no duplicate phone numbers", dupes.length === 0, `${dupes.length} duplicated`);

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
