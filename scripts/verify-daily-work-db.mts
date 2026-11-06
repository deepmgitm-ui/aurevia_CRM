// Read-only API checks; prints query success, never lead records or credentials.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { clinicDate } from "../lib/attendance.ts";
import { applyAssignmentDayFilter } from "../lib/daily-work.ts";

const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split(/\r?\n/).map(line => line.match(/^([A-Z0-9_]+)=(.*)$/)).filter(match => match !== null)
  .map(match => [match[1], match[2].trim().replace(/^['"]|['"]$/g, "")]));
const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const assignmentProbe = client.from("leads").select("id", { count: "exact", head: true });
const { error: assignmentProbeError } = await applyAssignmentDayFilter(assignmentProbe, clinicDate());
if (assignmentProbeError) throw new Error(`assigned: ${assignmentProbeError.message}`);
console.log("✓ assigned: API date filter passed");

const { data: dailyCounts, error: countsError } = await client.rpc("crm_daily_work_counts", { p_day: clinicDate() });
if (countsError) throw new Error(`daily card counts: ${countsError.message}`);
for (const kind of ["opd", "opdDone", "ipd", "ipdDone"] as const) {
  const ids: string[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client.rpc("crm_daily_lead_ids", { p_kind: kind, p_day: clinicDate() }).range(offset, offset + 499);
    if (error) throw new Error(`${kind} drill-down: ${error.message}`);
    ids.push(...(data ?? []).map((row: { id: string }) => row.id));
    if (!data || data.length < 500) break;
  }
  if (ids.length !== Number((dailyCounts as Record<string, number>)[kind] ?? 0)) {
    throw new Error(`${kind}: dashboard count does not match its drill-down IDs`);
  }
  console.log(`✓ ${kind}: ${ids.length} leads match the dashboard card`);
}

// Check the lightweight, paginated status projection against an exact total.
const day = clinicDate();
const counts = new Map<string | null, number>();
for (let offset = 0; ; offset += 500) {
  const query = client.from("leads").select("id,status").order("id").range(offset, offset + 499);
  const { data, error } = await applyAssignmentDayFilter(query, day);
  if (error) throw new Error(`assignment status projection: ${error.message}`);
  for (const row of data ?? []) counts.set(row.status ?? null, (counts.get(row.status ?? null) ?? 0) + 1);
  if (!data || data.length < 500) break;
}
const { count, error } = await applyAssignmentDayFilter(client.from("leads").select("id", { count: "exact", head: true }), day);
if (error) throw new Error(`assignment total: ${error.message}`);
if ([...counts.values()].reduce((sum, value) => sum + value, 0) !== count) throw new Error("Assignment status totals do not match the assigned-lead count.");
console.log("✓ assignment status projection: all pages match the exact assignment count");
