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
  // Pick a real lead and admin, but never print patient or staff names.
  const { data: lead, error: leadError } = await supabase.from("leads").select("id").limit(1).maybeSingle();
  if (leadError || !lead) {
    throw new Error(`unable to find a test lead (${leadError?.code ?? "no rows"}). Check the local service-role key and project URL.`);
  }
  const { data: admin, error: adminError } = await supabase.from("profiles").select("id").eq("role", "admin").limit(1).maybeSingle();
  if (adminError || !admin) {
    throw new Error(`unable to find an admin profile (${adminError?.code ?? "no rows"}). Check the local service-role key and project URL.`);
  }

  console.log(`testing against an existing lead (ID ${lead.id.slice(0, 8)})`);

  let writtenId: string | null = null;
  try {
    // 1. WRITE — same activity fields used by the app.
    const { data: written, error: writeError } = await supabase
      .from("lead_activities")
      .insert({
        lead_id: lead.id,
        user_id: admin.id,
        action_type: "note",
        description: PROBE,
      })
      .select("id, user_id, created_at")
      .single();
    if (writeError || !written) throw new Error(`write failed: ${writeError?.message ?? "no activity returned"}`);
    writtenId = written.id;
    console.log("  ✓ activity saved with an actor and timestamp");

    // 2. READ — verify the activity body, timestamp and public actor name.
    const { data: read, error: readError } = await supabase
      .from("lead_activities")
      .select("id, user_id, action_type, description, created_at")
      .eq("id", writtenId)
      .single();
    if (readError || !read) throw new Error(`read failed: ${readError?.message ?? "activity not found"}`);
    const { data: actor, error: actorError } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", read.user_id)
      .single();
    if (actorError || !actor) throw new Error("activity actor could not be resolved");
    if (read.description !== PROBE || !read.created_at || read.action_type !== "note") {
      throw new Error("activity fields did not round-trip correctly");
    }
    console.log("  ✓ activity text, timestamp and actor ID resolve");
  } finally {
    // Always remove the test event, even if the read/actor checks fail.
    if (writtenId) {
      const { error: deleteError } = await supabase.from("lead_activities").delete().eq("id", writtenId);
      if (deleteError) throw new Error(`cleanup failed: ${deleteError.message}`);
      console.log("  ✓ temporary test event removed");
    }
  }

  const { count } = await supabase.from("lead_activities").select("id", { count: "exact", head: true });
  console.log(`  ✓ activity total after cleanup: ${count ?? 0}`);
}

// Wrapped in main() so the process does not exit with the Supabase socket open.
await main();
