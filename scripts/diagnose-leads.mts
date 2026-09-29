// READ-ONLY diagnostic: why could the leads list come back empty?
// Run with: node scripts/diagnose-leads.mts
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
  const tables = [
    "leads",
    "lead_activities",
    "calendar_events",
    "profiles",
    "attendance",
    "lead_import_staging",
    "audit_logs",
  ];
  console.log("--- row counts (service role, RLS bypassed) ---");
  for (const table of tables) {
    const res = await supabase.from(table).select("*", { count: "exact", head: true });
    console.log(`  ${table}: ${res.count ?? "n/a"}${res.error ? `  ERROR ${res.error.code} ${res.error.message}` : ""}`);
  }

  console.log("\n--- profiles timestamps (did the DB get recreated?) ---");
  const profiles = await supabase
    .from("profiles")
    .select("name, role, created_at, updated_at")
    .order("created_at", { ascending: true })
    .limit(20);
  for (const row of (profiles.data ?? []) as Record<string, unknown>[]) {
    console.log(`  ${String(row.created_at ?? "-")} | ${String(row.role ?? "-")} | ${String(row.name ?? "-")}`);
  }
  if (profiles.error) console.log("  ERROR", profiles.error.message);

  console.log("\n--- auth.users (real logins) ---");
  const auth = await supabase.auth.admin.listUsers({ page: 1, perPage: 20 });
  for (const user of auth.data.users ?? []) {
    console.log(`  created ${user.created_at} | ${user.email} | last_sign_in ${user.last_sign_in_at ?? "-"}`);
  }
  if (auth.error) console.log("  ERROR", auth.error.message);

  console.log("\n--- leads created_at range (any surviving rows?) ---");
  const oldest = await supabase
    .from("leads")
    .select("created_at,name,status,assigned_to")
    .order("created_at", { ascending: true })
    .limit(5);
  console.log("oldest:", JSON.stringify(oldest.data), oldest.error?.message ?? "");
  const newest = await supabase
    .from("leads")
    .select("created_at,name,status,assigned_to")
    .order("created_at", { ascending: false })
    .limit(5);
  console.log("newest:", JSON.stringify(newest.data), newest.error?.message ?? "");
}

void main();

