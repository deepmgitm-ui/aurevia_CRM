// READ-ONLY diagnostic: which treatment names in remarks/disease does the
// current TREATMENT_PATTERNS list FAIL to catch?
// Run with: node scripts/scan-remarks.mts
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

const supabase = createClient(url, key, { auth: { persistSession: false } });

const { data, error } = await supabase.from("leads").select("disease, remarks").limit(1000);
if (error) throw new Error(error.message);

const { detectTreatmentName } = await import("../app/dashboard/overview/analytics.ts");

// Broad eye/medical vocabulary — anything here that current patterns MISS is a
// candidate for a new TREATMENT_PATTERNS entry.
const PROBE_WORDS = [
  "surgery", "operation", "transplant", "power", "specs", "spectacle", "glasses",
  "vision", "sight", "checkup", "check up", "eye", "cataract", "catract", "lasik",
  "icl", "retina", "glaucoma", "keratoconus", "squint", "dcr", "watering", "tear",
  "droopy", "ptosis", "floater", "sty", "cornea", "corneal", "blind", "low vision",
  "macula", "diabet", "number", "refractiv", "smile", "prk", "phaco", "iol",
  "globe", "counsel", "dilation", "oct", "frugel", "biometry",
];

let caughtByPattern = 0;
const missed = new Map<string, number>();

for (const row of data ?? []) {
  const remarks = typeof row.remarks === "string" ? row.remarks : "";
  const disease = typeof row.disease === "string" ? row.disease : "";
  // Same priority as the app: disease column first, remarks only as fallback.
  const source = disease.trim() && disease.trim() !== "-" ? disease : remarks;
  if (!source.trim()) continue;
  if (detectTreatmentName(source)) {
    caughtByPattern += 1;
    continue;
  }
  const lower = source.toLowerCase();
  for (const word of PROBE_WORDS) {
    if (lower.includes(word)) {
      missed.set(word, (missed.get(word) ?? 0) + 1);
      if ((missed.get(word) ?? 0) <= 4) {
        console.log(`MISSED [${word}]: ${source.slice(0, 110)}`);
      }
    }
  }
}

console.log(`\nrows whose disease/remarks text current patterns ${caughtByPattern} catch`);
console.log("words appearing in UNCAUGHT texts:");
for (const [word, count] of [...missed.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${word.padEnd(14)} ${count}`);
}