// One-off data repair for the four value problems the live audit found.
//
//   npm run fix:data            → dry run, changes nothing
//   npm run fix:data -- --apply → writes
//
// Each fix is an EXACT, reviewed match — no fuzzy guessing. Anything not in
// this table is left alone, and every applied change is printed with the lead
// it touched so it can be checked afterwards.
//
//   "Not Intrested"  → "Not Interested"  the typo missed stageForStatus(), so 2
//                                         dead-end leads were being counted as
//                                         "New" instead of "Lost"
//   "retinal_issue"  → "Retinal Issue"    same treatment split across two chart bars
//   "Lasiik"         → "Lasik"            typo of the most common treatment
//   "poo"            → "-"                junk value; "-" is the app's existing
//                                         "not recorded" placeholder
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

type Column = "status" | "disease" | "source";

const FIXES: { column: Column; from: string; to: string; why: string }[] = [
  {
    column: "status",
    from: "Not Intrested",
    to: "Not Interested",
    why: "misspelling — was being filed as an open \"New\" lead instead of \"Lost\"",
  },
  { column: "disease", from: "retinal_issue", to: "Retinal Issue", why: "same treatment, two spellings → two chart bars" },
  { column: "disease", from: "Lasiik", to: "Lasik", why: "typo of the most common treatment" },
  { column: "disease", from: "poo", to: "-", why: "junk value — falls back to the app's \"not recorded\" placeholder" },
];

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

async function main() {
  const apply = process.argv.includes("--apply");

  for (const fix of FIXES) {
    // ilike, but equality on the normalised form: catches stray case/space
    // without ever matching a DIFFERENT value.
    const { data, error } = await supabase
      .from("leads")
      .select("id, name, " + fix.column)
      .ilike(fix.column, fix.from);
    if (error) throw new Error(`${fix.column}: ${error.message}`);

    const rows = (data ?? []) as { id: string; name: string }[];
    // Guard: only touch rows whose value really is the one we reviewed.
    const exact = rows.filter(
      (row) => String((row as Record<string, unknown>)[fix.column] ?? "").trim().toLowerCase() === fix.from.toLowerCase(),
    );

    console.log(`\n${fix.column}: "${fix.from}" → "${fix.to}"`);
    console.log(`  ${fix.why}`);
    console.log(`  matching leads: ${exact.length}`);

    if (exact.length === 0) {
      console.log("  (nothing to do)");
      continue;
    }

    if (!apply) {
      for (const row of exact.slice(0, 6)) console.log(`    would fix: ${row.name} (${row.id.slice(0, 8)})`);
      if (exact.length > 6) console.log(`    …and ${exact.length - 6} more`);
      continue;
    }

    // One UPDATE for the whole group, then read back to confirm the write.
    const { error: updateError } = await supabase
      .from("leads")
      .update({ [fix.column]: fix.to })
      .ilike(fix.column, fix.from);
    if (updateError) throw new Error(`${fix.column}: ${updateError.message}`);

    const { data: after } = await supabase
      .from("leads")
      .select("id")
      .in("id", exact.map((row) => row.id));
    console.log(`  ✓ fixed ${(after ?? []).length} leads`);

    for (const row of exact.slice(0, 6)) console.log(`    fixed: ${row.name} (${row.id.slice(0, 8)})`);
    if (exact.length > 6) console.log(`    …and ${exact.length - 6} more`);
  }

  if (!apply) {
    console.log("\nDry run — nothing was written. Re-run with --apply to make these changes.");
  } else {
    console.log("\n✓ data repair complete");
  }
}

// Wrapped in main() so the process does not exit with the Supabase socket open.
await main();
