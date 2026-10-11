// Read-only API checks; prints query success, never lead records or credentials.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { clinicDate } from "../lib/attendance.ts";
import { applyDailyWorkFilter, type DailyWorkKind } from "../lib/daily-work.ts";

const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split(/\r?\n/).map(line => line.match(/^([A-Z0-9_]+)=(.*)$/)).filter(match => match !== null)
  .map(match => [match[1], match[2].trim().replace(/^['"]|['"]$/g, "")]));
const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
for (const kind of ["assigned", "opd", "ipd"] as DailyWorkKind[]) {
  const query = client.from("leads").select("id", { count: "exact", head: true });
  const { error } = await applyDailyWorkFilter(query, kind, clinicDate());
  if (error) throw new Error(`${kind}: ${error.message}`);
  console.log(`✓ ${kind}: API date filter passed`);
}
