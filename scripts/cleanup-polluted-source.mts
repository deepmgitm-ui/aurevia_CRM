// One-off repair: earlier imports stored the UPLOADED FILE NAME in leads.source
// (e.g. "Untitled spreadsheet.xlsx"), which polluted the Lead Source
// Performance chart. bulkInsertLeads no longer does that, but the rows already
// in the DB still carry the bad value.
//
//   node scripts/cleanup-polluted-source.mts            → dry run, changes nothing
//   node scripts/cleanup-polluted-source.mts --apply    → rewrite to "Excel/CSV"
//
// Rows whose source looks like a real campaign/channel (Meta Ads, Referral, …)
// are never touched. Leads that genuinely came from a sheet with a Source
// column keep their value, because this script only matches FILE-NAME shapes.
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

const FALLBACK_SOURCE = "Excel/CSV";

/** A value the import wrote because it had no Source column → the file name. */
function looksLikeFileName(source: string): boolean {
  const value = source.trim();
  if (!value || value === "-") return false;
  if (/\.(xlsx|xls|csv|tsv|ods|numbers|pdf|docx?)$/i.test(value)) return true;
  return /^(untitled|sheet\s*\d*|new\s+document|book\d*|google\s+sheets?)/i.test(value);
}

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

async function main(): Promise<void> {
  // "source" only — the repair must not drag the rest of the row along.
  const { data, error } = await supabase.from("leads").select("id, source").limit(5000);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as { id: string; source: string | null }[];
  const polluted = rows.filter((row) => typeof row.source === "string" && looksLikeFileName(row.source));

  const distinct = new Map<string, number>();
  for (const row of polluted) {
    const key = (row.source ?? "").trim();
    distinct.set(key, (distinct.get(key) ?? 0) + 1);
  }

  console.log(`leads scanned        : ${rows.length}`);
  console.log(`file-name sources    : ${polluted.length}`);
  for (const [value, count] of [...distinct].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count} × ${value}  →  ${FALLBACK_SOURCE}`);
  }

  if (polluted.length === 0) {
    console.log("\nnothing to repair ✓");
    return;
  }

  if (!process.argv.includes("--apply")) {
    console.log(`\ndry run — nothing changed. Re-run with --apply to set these ${polluted.length} leads to "${FALLBACK_SOURCE}".`);
    return;
  }

  // Chunked so a 5k-row repair can't trip a single oversized request.
  const CHUNK = 200;
  for (let index = 0; index < polluted.length; index += CHUNK) {
    const chunk = polluted.slice(index, index + CHUNK);
    const { error: updateError } = await supabase
      .from("leads")
      .update({ source: FALLBACK_SOURCE })
      .in("id", chunk.map((row) => row.id));
    if (updateError) throw new Error(`${updateError.message} (chunk at ${index})`);
    console.log(`  updated ${Math.min(index + CHUNK, polluted.length)}/${polluted.length}`);
  }

  console.log(`\n✓ ${polluted.length} leads re-filed under "${FALLBACK_SOURCE}"`);
}

// No process.exit() here: killing the process with the Supabase socket open
// trips a libuv assertion on Windows and turns a clean run into a red exit code.
await main();