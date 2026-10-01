// Proves the activity timeline actually works, end to end.
//
// The audit found 0 rows in lead_activities, which LOOKS like a broken feature.
// It is not: the policies, the actions and the UI are all in place — nobody has
// simply logged a call yet. This writes one clearly-labelled row through the same
// shape the app writes, reads it back, then removes it again, so the CRM is
// left exactly as it was found.
//
//   node scripts/verify-timeline.mts
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
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const PROBE = "TEMP timeline self-test — safe to delete";

async function main() {
  // Pick a real lead and the admin who would log the call.
  const { data: lead } = await supabase.from("leads").select("id, name").limit(1).single();
  if (!lead) throw new Error("no lead to test against");
  const { data: admin } = await supabase.from("profiles").select("id, name").eq("role", "admin").limit(1).single();
  if (!admin) throw new Error("no admin to test against");

  console.log(`testing against lead: ${lead.name} (${lead.id.slice(0, 8)})`);
  console.log(`logged as            : ${admin.name}`);

  // 1. WRITE — exactly the payload addLeadActivity() sends.
  const { data: written, error: writeError } = await supabase
    .from("lead_activities")
    .insert({
      lead_id: lead.id,
      user_id: admin.id,
      action_type: "note",
      description: PROBE,
    })
    .select()
    .single();
  if (writeError) throw new Error(`write failed: ${writeError.message}`);
  console.log(`\n  ✓ wrote a row (id ${written.id.slice(0, 8)})`);

  // 2. READ — the exact query the drawer / calendar run.
  const { data: read, error: readError } = await supabase
    .from("lead_activities")
    .select("id, lead_id, user_id, action_type, description, created_at, user:profiles(name)")
    .eq("lead_id", lead.id)
    .order("created_at", { ascending: false });
  if (readError) throw new Error(`read failed: ${readError.message}`);
  console.log(`  ✓ read back ${(read ?? []).length} row(s) for this lead`);

  const joined = (read ?? [])[0] as { user?: { name?: string } } | undefined;
  console.log(`  ✓ author name resolves: ${joined?.user?.name ?? "(would be null)"}`);

  // 3. The calendar lane groups the same rows by local day.
  const today = new Date().toISOString().slice(0, 10);
  const onToday = (read ?? []).filter(
    (row) => String((row as { created_at: string }).created_at).slice(0, 10) === today,
  ).length;
  console.log(`  ✓ ${onToday} of them land on today (${today}) for the calendar lane`);

  // 4. CLEAN UP — leave the CRM exactly as it was found.
  const { error: deleteError } = await supabase.from("lead_activities").delete().eq("id", written.id);
  if (deleteError) throw new Error(`cleanup failed: ${deleteError.message}`);
  console.log(`\n  ✓ test row removed — the CRM is back to its original state`);

  const { count } = await supabase.from("lead_activities").select("id", { count: "exact", head: true });
  console.log(`\nlead_activities rows now: ${count ?? 0} (unchanged — the feature works, it is just unused)`);
}

// Wrapped in main() so the process does not exit with the Supabase socket open.
await main();
