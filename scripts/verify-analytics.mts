// Regression checks for the dashboard analytics + gamification helpers.
// Run with: npm run verify:analytics
import assert from "node:assert/strict";

import {
  buildDashboardMetrics,
  currentQuarterRange,
  defaultDashboardRange,
  resolveDashboardMetrics,
  createSampleMetrics,
  detectTreatmentName,
  findTopPerformer,
  resolveTreatmentText,
  slugifyTreatment,
  stageForStatus,
  toAnalyticsLead,
  treatmentBucket,
  TREATMENT_COLORS,
  type AgentStat,
  type AnalyticsLead,
  type DateRange,
} from "../app/dashboard/overview/analytics.ts";
import {
  cheerFor,
  greetingHeadline,
  partOfDay,
} from "../app/dashboard/overview/greeting-copy.ts";

const RANGE: DateRange = { from: "2026-07-01", to: "2026-09-30" };

function lead(id: string, treatment: string, status: string): AnalyticsLead {
  return {
    id,
    name: `Patient ${id}`,
    city: "Delhi NCR",
    disease: "-",
    treatment,
    source: "Meta Ads",
    status,
    temperature: "Hot",
    assigned_to: "Ravi Sharma",
    lead_date: "15/08/2026",
  };
}

const rows: AnalyticsLead[] = [
  lead("1", "LASIK", "New"),
  lead("2", "lasik", "OPD Booked"),
  lead("3", "Lasik", "IPD Done"),
  lead("4", "LASIK Eye Surgery", "Contacted"), // family match → LASIK
  lead("5", "Cataract", "Won"),
  lead("6", "cataract", "Contacted"),
  lead("7", "ICL", "Proposal"),
  lead("8", "icl", "Lost"),
  lead("9", "Retina Detachment", "New"), // free text keeps its own label
  lead("10", "-", "Dropped"), // dropped status → Lost/Dropped bucket
  lead("11", "retina detachment", "Contacted"), // case-insensitive free text
];

const metrics = buildDashboardMetrics(rows, [], RANGE);

// 1. Treatments are discovered dynamically and grouped case-insensitively.
const labels = metrics.treatmentSeries.map((series) => series.label);
assert.deepEqual(
  labels.slice(0, 3),
  ["LASIK", "Cataract", "ICL"],
  `preferred families must sort first, got: ${labels.join(", ")}`,
);
assert.ok(labels.includes("Retina"), "free-text disease maps to its service line label");

// 2. Every LASIK spelling collapses into ONE series (no more "everything is Other").
const pipeline = metrics.pipeline;
const lasikKey = metrics.treatmentSeries[0].key;
const lasikTotal = pipeline.reduce(
  (sum, row) => sum + (row.series.find((cell) => cell.key === lasikKey)?.value ?? 0),
  0,
);
assert.equal(lasikTotal, 4, `LASIK total must count all 4 spellings, got ${lasikTotal}`);

const retinaKey = metrics.treatmentSeries.find((s) => s.label === "Retina")!.key;
const retinaTotal = pipeline.reduce(
  (sum, row) => sum + (row.series.find((cell) => cell.key === retinaKey)?.value ?? 0),
  0,
);
assert.equal(retinaTotal, 2, "case-variant free-text treatments must merge");

// 3. Status × treatment grouping: a surgery-stage LASIK lead lands on the right row/stage.
const surgeryRow = pipeline.find((row) => row.key === "surgery")!;
assert.equal(
  surgeryRow.series.find((cell) => cell.key === lasikKey)?.value,
  1,
  "LASIK + IPD Done must sit in the Surgery Completed row",
);

// 4. Lost/Dropped KPI replaces Revenue entirely.
const kpiKeys = metrics.kpis.map((kpi) => kpi.key);
assert.ok(kpiKeys.includes("lostLeads"), "Lost/Dropped Leads KPI must exist");
assert.ok(
  !kpiKeys.some((key) => String(key).toLowerCase().includes("revenue")),
  "Revenue KPI must be gone",
);
const lostKpi = metrics.kpis.find((kpi) => kpi.key === "lostLeads")!;
assert.equal(lostKpi.value, "2", "Lost (1) + Dropped (1) = 2");

// 5. No revenue / currency strings anywhere in the metrics payload.
const serialized = JSON.stringify(metrics);
assert.ok(!/revenue/i.test(serialized), "metrics must not mention revenue");
assert.ok(!serialized.includes("₹"), "metrics must not contain currency symbols");
assert.equal(metrics.totals.lost, 2, "totals.lost must replace totals.revenue");

// 6. Stage totals table sums match the chart totals.
for (const row of pipeline) {
  const sum = row.series.reduce((total, cell) => total + cell.value, 0);
  assert.equal(sum, row.total, `row ${row.key} cells must sum to its total`);
}
const pipelineGrandTotal = pipeline.reduce((total, row) => total + row.total, 0);
assert.equal(pipelineGrandTotal, 9, "lost/dropped leads must never leak into the funnel");

// 7. Sample (empty database) payload follows the same contract.
const sample = createSampleMetrics(RANGE);
assert.ok(sample.kpis.some((kpi) => kpi.key === "lostLeads"));
assert.ok(!JSON.stringify(sample).toLowerCase().includes("revenue"));
assert.equal(sample.pipeline[0].total, 640, "sample funnel totals stay intact");
const resolvedEmpty = resolveDashboardMetrics([], RANGE, []);
assert.equal(resolvedEmpty.isSample, true, "empty database falls back to preview data");

// ---------------------------------------------------------------------------
// 8. Treatment resolution reads EVERY plausible column. This is the regression
//    guard for the "everything is one Other bar" bug: a blank `treatment_type`
//    must fall through to a populated `disease`, and "-" placeholders are skipped.
// ---------------------------------------------------------------------------
assert.equal(resolveTreatmentText({ disease: "Cataract" }), "Cataract", "disease must feed the series");
assert.equal(
  resolveTreatmentText({ treatment_type: "   ", disease: "LASIK" }),
  "LASIK",
  "blank treatment_type must fall through to disease",
);
assert.equal(resolveTreatmentText({ treatment: "-", disease: "ICL" }), "ICL", '"-" must be skipped');
assert.equal(
  resolveTreatmentText({ surgery_type: "Phaco", disease: "LASIK" }),
  "Phaco",
  "surgery_type outranks the legacy disease column",
);
assert.equal(resolveTreatmentText({}), "", "a row with no treatment column resolves to empty");

type LeadInput = Parameters<typeof toAnalyticsLead>[0];
const converted = toAnalyticsLead({ id: "c1", disease: "Cataract", status: "Won" } as unknown as LeadInput);
assert.equal(converted.treatment, "Cataract", "toAnalyticsLead must surface the resolved treatment");

// ---------------------------------------------------------------------------
// 9. Case-insensitive + typo-tolerant family mapping, and the canonical colours
//    the chart legend promises (LASIK dark blue, Cataract light blue, ICL purple).
// ---------------------------------------------------------------------------
const familyCases: [string, string][] = [
  ["lasik", "lasik"],
  ["LASIK", "lasik"],
  ["Lasic", "lasik"],
  ["LASIK Eye Surgery", "lasik"],
  ["Contoura", "lasik"],
  ["cataract", "cataract"],
  ["CATARACT (LE)", "cataract"],
  ["Catract", "cataract"],
  ["Phaco", "cataract"],
  ["ICL", "icl"],
  ["icl implant", "icl"],
  ["Retina Detachment", "other"],
  ["-", "other"],
];
for (const [input, expected] of familyCases) {
  assert.equal(treatmentBucket(input), expected, `"${input}" must map to ${expected}`);
}

assert.equal(metrics.treatmentSeries[0].color, TREATMENT_COLORS.lasik, "LASIK keeps its brand colour");
assert.equal(
  metrics.treatmentSeries.find((series) => series.key === "cataract")?.color,
  TREATMENT_COLORS.cataract,
  "Cataract keeps its colour",
);
assert.equal(
  metrics.treatmentSeries.find((series) => series.key === "icl")?.color,
  TREATMENT_COLORS.icl,
  "ICL keeps its colour",
);
assert.equal(
  new Set(metrics.treatmentSeries.map((series) => series.color)).size,
  metrics.treatmentSeries.length,
  "every treatment segment needs a distinct colour",
);

// ---------------------------------------------------------------------------
// 10. Free-text series keys are slugs, so Recharts (which reads dots as nested
//     paths) can never blank out a segment.
// ---------------------------------------------------------------------------
assert.equal(slugifyTreatment("Retina / Vitreous 2.5"), "retina-vitreous-2-5");
assert.equal(slugifyTreatment("!!!"), "other");
for (const series of metrics.treatmentSeries) {
  assert.ok(/^[a-z0-9-]+$/.test(series.key), `dataKey "${series.key}" must be Recharts-safe`);
}

// ---------------------------------------------------------------------------
// 11. Gamification — "Star of the Month" crown.
// ---------------------------------------------------------------------------
function agent(name: string, surgeries: number, consultations: number, leads: number): AgentStat {
  return {
    id: name,
    name,
    role: "employee",
    leads,
    newLeads: 0,
    hot: 0,
    warm: 0,
    cold: 0,
    consultations,
    surgeries,
    lost: 0,
    conversion: 0,
  };
}

const crowned = findTopPerformer([
  agent("Aarav", 2, 5, 10),
  agent("Bhavna", 5, 1, 8),
  agent("Chirag", 5, 4, 2),
  agent("Idle", 0, 0, 0),
])!;
assert.equal(crowned.name, "Chirag", "most surgeries wins, consultations break the tie");
assert.equal(crowned.metric, "surgeries");
assert.equal(findTopPerformer([agent("Idle", 0, 0, 0)]), null, "an idle roster shows no crown");
assert.equal(findTopPerformer([]), null, "an empty roster shows no crown");
const consultCrown = findTopPerformer([agent("Xena", 0, 7, 9), agent("Yash", 0, 3, 4)])!;
assert.equal(consultCrown.name, "Xena", "without surgeries the crown falls back to consultations");
assert.equal(consultCrown.metric, "consultations");

// ---------------------------------------------------------------------------
// 12. Dynamic greeting (morning / afternoon / evening + role-aware cheer).
// ---------------------------------------------------------------------------
assert.equal(partOfDay(0), "morning");
assert.equal(partOfDay(11), "morning");
assert.equal(partOfDay(12), "afternoon");
assert.equal(partOfDay(16), "afternoon");
assert.equal(partOfDay(17), "evening");
assert.equal(partOfDay(23), "evening");
assert.equal(greetingHeadline("morning", "Admin"), "Good Morning, Admin!");
assert.equal(greetingHeadline("evening", "  "), "Good Evening, there!", "blank names fall back to a placeholder");
assert.ok(cheerFor("admin", "morning").includes("close some deals"), "admins get the deals line");
assert.ok(cheerFor("employee", "morning").includes("pipeline"), "employees get their own line");
assert.ok(cheerFor("manager", "afternoon").includes("team"), "managers get the team line");

// ---------------------------------------------------------------------------
// 13. Free-text remarks fallback — the real-world CRM shape: no treatment
//     column, the treatment written inside the reminder note.
// ---------------------------------------------------------------------------
assert.equal(
  resolveTreatmentText({ remarks: "age -25 , lasik , tuesday call back" }),
  "LASIK",
  "a LASIK mention in the remarks must feed the series",
);
assert.equal(resolveTreatmentText({ remarks: "doctor sugested toric lens" }), "Cataract");
assert.equal(resolveTreatmentText({ remarks: "looking for some glasses" }), "Spectacles");
assert.equal(resolveTreatmentText({ remarks: "invalid number" }), "", "call noise must never become a treatment");
assert.equal(resolveTreatmentText({ remarks: "no respones on wa" }), "");
assert.equal(
  resolveTreatmentText({ disease: "Cataract", remarks: "lasik" }),
  "Cataract",
  "the dedicated disease field always outranks the remarks fallback",
);
assert.equal(detectTreatmentName("age -49 ... catract , dec"), "Cataract", "typos in remarks are handled");

// ---------------------------------------------------------------------------
// 14. Missing treatment is labelled honestly: grey "Not Recorded", never "Other".
// ---------------------------------------------------------------------------
const coverageRows: AnalyticsLead[] = [
  lead("k1", "LASIK", "New"),
  lead("k2", "-", "Contacted"),
  lead("k3", "", "Contacted"),
];
const coverageMetrics = buildDashboardMetrics(coverageRows, [], RANGE);
assert.deepEqual(
  coverageMetrics.treatmentCoverage,
  { recorded: 1, total: 3 },
  "coverage must count funnel leads with a treatment on record",
);
const unrecorded = coverageMetrics.treatmentSeries.at(-1)!;
assert.equal(unrecorded.key, "unrecorded", '"Not Recorded" must be the last series');
assert.equal(unrecorded.label, "Not Recorded");
assert.equal(unrecorded.color, TREATMENT_COLORS.unrecorded, "Not Recorded must be grey, not a treatment colour");
assert.equal(coverageMetrics.treatmentSeries[0].key, "lasik", "real treatments still come first");

// ---------------------------------------------------------------------------
// 15. Status → stage mapping for the statuses this CRM actually stores.
// ---------------------------------------------------------------------------
const stageCases: [string, string][] = [
  ["New", "new"],
  ["", "new"],
  ["DNP", "contacted"],
  ["DNP 3", "contacted"],
  ["RNR", "contacted"],
  ["Follow Up", "contacted"],
  ["Call Back", "contacted"],
  ["OPD Booked", "booked"],
  ["IPD Booked", "booked"],
  ["Surgery Scheduled", "booked"],
  ["OPD Done", "attended"],
  ["IPD Done", "surgery"],
  ["Won", "surgery"],
  ["Surgery Completed", "surgery"],
  ["Lost", "lost"],
  ["Dropped", "lost"],
  ["Not Interested", "lost"],
  ["Invalid Number", "lost"],
  ["Non Surgical", "lost"],
  ["Budget Issue", "lost"],
  ["Location Issue", "lost"],
];
for (const [status, expected] of stageCases) {
  assert.equal(stageForStatus(status), expected, `"${status}" must map to ${expected}`);
}

// ---------------------------------------------------------------------------
// 16. The user's core ask: a disease/treatment WRITTEN in the leads table shows
//     under that exact name — its own segment, never swallowed by "Other".
// ---------------------------------------------------------------------------
const writtenRows: AnalyticsLead[] = [
  lead("w1", "Hernia", "New"),
  lead("w2", "hernia", "Contacted"), // case variants merge into one segment
  lead("w3", "Knee Replacement", "OPD Booked"),
  lead("w4", "Appendix Removal", "IPD Done"),
  lead("w5", "Gall Bladder Stone", "New"),
  lead("w6", "-", "Contacted"), // nothing written → honest "Not Recorded"
];
const writtenMetrics = buildDashboardMetrics(writtenRows, [], RANGE);
const writtenLabels = writtenMetrics.treatmentSeries.map((series) => series.label);
for (const name of ["Hernia", "Knee Replacement", "Appendix Removal", "Gall Bladder Stone"]) {
  assert.ok(
    writtenLabels.includes(name),
    `written disease "${name}" must get its own segment, got: ${writtenLabels.join(", ")}`,
  );
}
assert.ok(
  !writtenLabels.includes("Other"),
  "fewer written treatments than the cap ⇒ NO Other bucket at all",
);
const herniaKey = writtenMetrics.treatmentSeries.find((series) => series.label === "Hernia")!.key;
const herniaTotal = writtenMetrics.pipeline.reduce(
  (sum, row) => sum + (row.series.find((cell) => cell.key === herniaKey)?.value ?? 0),
  0,
);
assert.equal(herniaTotal, 2, "case variants of one written disease must merge into one segment");

// ---------------------------------------------------------------------------
// 17. More written treatments than the legend cap: the biggest stay named, only
//     the SMALLEST tail folds into "Other" (never a blanket bucket).
// ---------------------------------------------------------------------------
const manyRows: AnalyticsLead[] = [];
for (let index = 1; index <= 14; index++) {
  for (let count = 0; count < 15 - index; count++) {
    manyRows.push(lead(`m${index}-${count}`, `Written Treatment ${index}`, "New"));
  }
}
const manyMetrics = buildDashboardMetrics(manyRows, [], RANGE);
const manyLabels = manyMetrics.treatmentSeries.map((series) => series.label);
const namedLabels = manyLabels.filter((label) => label !== "Other" && label !== "Not Recorded");
assert.equal(namedLabels.length, 11, `top 11 written treatments stay named, got: ${manyLabels.join(", ")}`);
assert.ok(namedLabels.includes("Written Treatment 1"), "the biggest bucket must keep its name");
assert.ok(namedLabels.includes("Written Treatment 11"), "eleven named slots available");
assert.ok(!namedLabels.includes("Written Treatment 12"), "only the smallest tail folds away");
const foldedKey = manyMetrics.treatmentSeries.find((series) => series.label === "Other")?.key;
const foldedTotal = manyMetrics.pipeline.reduce(
  (sum, row) => sum + (row.series.find((cell) => cell.key === foldedKey)?.value ?? 0),
  0,
);
assert.equal(foldedTotal, 3 + 2 + 1, "Other holds exactly the three smallest written treatments");

// ---------------------------------------------------------------------------
// 18. The opening window must never hide a full pipeline: the quarter wins
//     whenever it has leads, otherwise it snaps onto the months the data is in
//     (the March 2026 import against a Jul-Sep window).
// ---------------------------------------------------------------------------
const TODAY = new Date(2026, 7, 15); // 15 Aug 2026 → Q3 = Jul-Sep
const dated = (leadDate: string): AnalyticsLead => ({ ...lead("d", "LASIK", "New"), lead_date: leadDate });

const quarter = currentQuarterRange(TODAY);
assert.deepEqual(quarter, { from: "2026-07-01", to: "2026-09-30" }, "Q3 window for 15 Aug 2026");

assert.deepEqual(
  defaultDashboardRange([dated("15/08/2026"), dated("02/09/2026")], TODAY),
  quarter,
  "leads inside the quarter keep the quarter window",
);

assert.deepEqual(
  defaultDashboardRange([dated("05/03/2026"), dated("27/03/2026")], TODAY),
  { from: "2026-03-01", to: "2026-03-31" },
  "an empty quarter snaps onto the single month the data covers",
);

assert.deepEqual(
  defaultDashboardRange([dated("05/01/2026"), dated("27/05/2026")], TODAY),
  { from: "2026-01-01", to: "2026-05-31" },
  "a multi-month import opens on the full span, month start to month end",
);

assert.deepEqual(
  defaultDashboardRange([dated("05/03/2026"), dated("15/08/2026")], TODAY),
  quarter,
  "one lead inside the quarter is enough to keep the quarter window",
);

assert.deepEqual(
  defaultDashboardRange([], TODAY),
  quarter,
  "no leads at all keeps the plain current quarter",
);

assert.deepEqual(
  defaultDashboardRange([dated("not a date"), dated("-")], TODAY),
  quarter,
  "leads without a usable date can't move the window",
);

const snapped = defaultDashboardRange([dated("05/03/2026")], TODAY);
const nonEmpty = buildDashboardMetrics([dated("05/03/2026"), dated("09/03/2026")], [], snapped);
assert.ok(
  nonEmpty.kpis.length > 0 && nonEmpty.pipeline.reduce((sum, row) => sum + row.total, 0) === 2,
  "the snapped window really does show the imported leads instead of zeroes",
);

console.log("✓ all analytics assertions passed");
console.log("  treatment series:", labels.join(", "));
console.log("  kpi keys:", kpiKeys.join(", "));
console.log(
  "  pipeline totals:",
  pipeline.map((row) => `${row.stage}=${row.total}`).join(", "),
);
console.log("  star of the month:", crowned.name, `(${crowned.metric})`);
console.log("  greeting checks: morning/afternoon/evening + role cheer verified");
