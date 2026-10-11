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
for (const kind of ["assigned", "opd", "opdDone", "ipd"] as DailyWorkKind[]) {
  const query = client.from("leads").select("id", { count: "exact", head: true });
  const { error } = await applyDailyWorkFilter(query, kind, clinicDate());
  if (error) throw new Error(`${kind}: ${error.message}`);
  console.log(`✓ ${kind}: API date filter passed`);
}

// Check the lightweight, paginated status projection against an exact total.
const day = clinicDate();
const counts = new Map<string | null, number>();
for (let offset = 0; ; offset += 500) {
  const query = client.from("leads").select("id,status").order("id").range(offset, offset + 499);
  const { data, error } = await applyDailyWorkFilter(query, "assigned", day);
  if (error) throw new Error(`assignment status projection: ${error.message}`);
  for (const row of data ?? []) counts.set(row.status ?? null, (counts.get(row.status ?? null) ?? 0) + 1);
  if (!data || data.length < 500) break;
}
const { count, error } = await applyDailyWorkFilter(client.from("leads").select("id", { count: "exact", head: true }), "assigned", day);
if (error) throw new Error(`assignment total: ${error.message}`);
if ([...counts.values()].reduce((sum, value) => sum + value, 0) !== count) throw new Error("Assignment status totals do not match the assigned-lead count.");
console.log("✓ assignment status projection: all pages match the exact assignment count");
