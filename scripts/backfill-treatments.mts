// Backfills the empty `disease` (Treatment) column from remarks that CLEARLY name
// a treatment, so those leads show under their disease in the pipeline chart.
//
// DEFAULT IS REPORT-ONLY (writes nothing). Review the list, then run with
// --apply to write. Optional: --limit=N applies to the first N rows only.
//
//   node scripts/backfill-treatments.mts            → report only
//   node scripts/backfill-treatments.mts --apply    → write disease for matches
//
// Safety rules (conservative by design — wrong data is worse than grey data):
//   1. Only rows whose `disease` is blank (""/"-"/null) are ever touched.
//   2. Only STRONG keywords count (lasik/catract/icl/retina/… — NOT generic
//      words like "lens", "glasses", "power", "laser" that appear in any sentence).
//   3. Remarks with a negation ("not looking", "not interested", "not for …
//      treatment") are skipped even when they mention a keyword.
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

const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply");
const limitArg = [...args].find((arg) => arg.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : Number.POSITIVE_INFINITY;

// Strong keywords: a remark containing one of these PROVES the treatment was
// discussed. Deliberately excludes the fuzzy main-chart patterns (laser, lens,
// implant, specs, power, diabet, smile) — great for grouping, too risky for
// writing into the database.
const STRONG: { pattern: RegExp; label: string }[] = [
  { pattern: /(lasik|lasic|lasek|lazik|lasix|femto|contoura|wavefront|\bprk\b|refractiv)/, label: "LASIK" },
  { pattern: /(cataract|catract|catarct|cateract|motiyabind|motia|phaco|\biol\b|toric)/, label: "Cataract" },
  { pattern: /(\bicl\b|\bicle\b|phakic|collamer)/, label: "ICL" },
  { pattern: /(retina|vitreous|macula)/, label: "Retina" },
  { pattern: /(keratoconus|cross ?link)/, label: "Keratoconus" },
  { pattern: /(squint|strabismus)/, label: "Squint" },
  { pattern: /(glaucoma)/, label: "Glaucoma" },
  { pattern: /(pterygium)/, label: "Pterygium" },
  { pattern: /(\bdcr\b|dacryo|watering eye)/, label: "DCR" },
  { pattern: /(ptosis|oculoplasty|chalazion|dermoid)/, label: "Oculoplasty" },
];

const NEGATION = /\bnot\s+(looking|interested|for)\b/;
const PLACEHOLDER = new Set(["", "-", "--", ".", "na", "n/a", "none", "nil", "null", "unknown"]);

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error("Supabase URL / key missing in .env.local");

const supabase = createClient(url, key, { auth: { persistSession: false } });

// Page through all leads (1000 per page — more than enough, but correct anyway).
const rows: Record<string, unknown>[] = [];
for (let page = 0; ; page++) {
  const { data, error } = await supabase
    .from("leads")
    .select("id,name,disease,remarks")
    .range(page * 1000, page * 1000 + 999);
  if (error) throw new Error(error.message);
  rows.push(...((data ?? []) as Record<string, unknown>[]));
  if (!data || data.length < 1000) break;
}

let blank = 0;
let alreadyFilled = 0;
const candidates: { id: string; name: string; remark: string; label: string }[] = [];

for (const row of rows) {
  const disease = typeof row.disease === "string" ? row.disease.trim() : "";
  if (!PLACEHOLDER.has(disease.toLowerCase())) {
    alreadyFilled += 1;
    continue;
  }
  blank += 1;
  const remark = typeof row.remarks === "string" ? row.remarks : "";
  if (!remark.trim() || NEGATION.test(remark.toLowerCase())) continue;
  const lower = remark.toLowerCase();
  const hit = STRONG.find((entry) => entry.pattern.test(lower));
  if (!hit) continue;
  candidates.push({
    id: String(row.id),
    name: String(row.name ?? "").slice(0, 30),
    remark: remark.slice(0, 90),
    label: hit.label,
  });
}

console.log(`leads scanned: ${rows.length} (disease already filled: ${alreadyFilled}, blank: ${blank})`);
console.log(`backfill candidates (strong keyword, no negation): ${candidates.length}\n`);
for (const candidate of candidates.slice(0, 40)) {
  console.log(`  → ${candidate.label.padEnd(10)} | ${candidate.name} | ${candidate.remark}`);
}
if (candidates.length > 40) console.log(`  … and ${candidates.length - 40} more`);

if (!APPLY) {
  console.log("\nREPORT ONLY — nothing was written. Re-run with --apply to fill disease.");
  process.exit(0);
}

const toWrite = candidates.slice(0, LIMIT);
let written = 0;
for (const candidate of toWrite) {
  const { error } = await supabase.from("leads").update({ disease: candidate.label }).eq("id", candidate.id);
  if (error) {
    console.log(`  ✗ ${candidate.name}: ${error.message}`);
  } else {
    written += 1;
  }
}
console.log(`\nWROTE disease for ${written}/${toWrite.length} leads. Re-run inspect-leads to see the new pipeline.`);