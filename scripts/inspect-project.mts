// READ-ONLY: is this a fresh Supabase project (data lives elsewhere) or the
// same project after a wipe? Prints table sizes + profile/audit timestamps.
// Run with: node scripts/inspect-project.mts
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

async function main() {
  console.log(`project: ${url}\n`);
  console.log("--- table sizes ---");
  for (const table of ["leads", "lead_activities", "profiles", "calendar_events", "tasks", "attendance", "lead_deletion_backups"]) {
    const res = await supabase.from(table).select("*", { count: "exact", head: true });
    console.log(`  ${table}: ${res.error ? `MISSING (${res.error.code})` : res.count}`);
  }

  console.log("\n--- profiles (when was this project set up?) ---");
  const profiles = await supabase.from("profiles").select("name, role, created_at").order("created_at");
  for (const row of (profiles.data ?? []) as Record<string, unknown>[]) {
    console.log(`  ${String(row.created_at ?? "-")} | ${String(row.role ?? "-")} | ${String(row.name ?? "-")}`);
  }

  console.log("\n--- auth users (newest first) ---");
  const auth = await supabase.auth.admin.listUsers({ page: 1, perPage: 50 });
  const users = (auth.data.users ?? []).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  for (const user of users.slice(0, 12)) console.log(`  ${user.created_at} | ${user.email}`);

  console.log("\n--- leads: any row at all (id scan, max 3) ---");
  const any = await supabase.from("leads").select("id").limit(3);
  console.log("  ", JSON.stringify(any.data), any.error?.message ?? "");
}

void main();
