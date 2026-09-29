// Regression checks for the Meta lead-form parser (lib/meta-lead.ts).
// Run with: npm run verify:meta
import assert from "node:assert/strict";

import {
  META_FIELD_ALIASES,
  detectTreatmentInText,
  extractMetaLead,
  metaFieldLabel,
  normalizeMetaLabel,
  sanitizeMetaPhone,
} from "../lib/meta-lead.ts";

// ---------------------------------------------------------------------------
// 1. Label normalisation — the whole point of the module.
// ---------------------------------------------------------------------------
assert.equal(normalizeMetaLabel("Which treatment are you interested in?"), "which_treatment_are_you_interested_in");
assert.equal(normalizeMetaLabel("  Phone Number  "), "phone_number");
assert.equal(normalizeMetaLabel("E-mail"), "e_mail");
assert.equal(metaFieldLabel({ field_name: "full_name" }), "full_name");
assert.equal(metaFieldLabel({ name: "FULL_NAME" }), "full_name"); // Graph API response shape
assert.equal(metaFieldLabel({}), "");

// ---------------------------------------------------------------------------
// 2. A textbook Meta form still maps 1:1.
// ---------------------------------------------------------------------------
const standardForm = [
  { field_name: "full_name", values: ["Ravi Kumar"] },
  { field_name: "phone_number", values: ["+91 98765 43210"] },
  { field_name: "email", values: ["ravi@example.com"] },
  { field_name: "city", values: ["Mumbai"] },
  { field_name: "disease", values: ["Cataract"] },
];
const standard = extractMetaLead(standardForm);
assert.equal(standard.name, "Ravi Kumar");
assert.equal(standard.phone, "9876543210");
assert.equal(standard.email, "ravi@example.com");
assert.equal(standard.city, "Mumbai");
assert.equal(standard.disease, "Cataract");
assert.equal(standard.remarks, "-");
assert.match(standard.leadDate, /^\d{2}\/\d{2}\/\d{4}$/);

// ---------------------------------------------------------------------------
// 3. The real-world gap: custom question names (why treatments showed blank).
// ---------------------------------------------------------------------------
const customForm = [
  { field_name: "full_name", values: ["Neha"] },
  { field_name: "phone", values: ["09876543210"] },
  { field_name: "which_treatment_are_you_interested_in", values: ["Lasik"] },
  { field_name: "which_city_do_you_live_in", values: ["Pune"] },
  { field_name: "preferred_call_time", values: ["Evening"] },
];
const custom = extractMetaLead(customForm);
assert.equal(custom.name, "Neha");
assert.equal(custom.phone, "9876543210");
assert.equal(custom.city, "Pune", "a custom city question must still fill the city column");
assert.equal(custom.disease, "Lasik", "a custom treatment question must still fill the treatment column");
assert.ok(custom.remarks.includes("preferred call time: Evening"), "unknown questions are preserved in remarks");

// ---------------------------------------------------------------------------
// 4. Odd but common shapes.
// ---------------------------------------------------------------------------
const eyeForm = [
  { field_name: "name", values: ["Amit"] },
  { field_name: "phone_number", values: ["9876543210"] },
  { field_name: "eye_problem", values: ["Left eye cataract, wants surgery"] },
];
assert.equal(extractMetaLead(eyeForm).disease, "Left eye cataract, wants surgery");

// Treatment named nothing recognisable → the free-text answer is scanned last.
const noTreatmentField = [
  { field_name: "name", values: ["Sara"] },
  { field_name: "phone", values: ["9876543210"] },
  { field_name: "message", values: ["I want lasik for both eyes"] },
];
assert.equal(extractMetaLead(noTreatmentField).disease, "LASIK");

// Empty payload must never crash and must not invent values.
const empty = extractMetaLead([]);
assert.equal(empty.name, "-");
assert.equal(empty.phone, "-");
assert.equal(empty.city, "-");
assert.equal(empty.disease, "-");

// ---------------------------------------------------------------------------
// 5. Phone + treatment helpers.
// ---------------------------------------------------------------------------
assert.equal(sanitizeMetaPhone("+91 98765 43210"), "9876543210");
assert.equal(sanitizeMetaPhone("98765-43210"), "9876543210");
assert.equal(sanitizeMetaPhone("12345"), "12345"); // short numbers survive as-is
assert.equal(sanitizeMetaPhone("-"), "-");
assert.equal(sanitizeMetaPhone(undefined), "-");

assert.equal(detectTreatmentInText("patient needs motiyabind operation"), "Cataract");
assert.equal(detectTreatmentInText("wants ICL implant"), "ICL");
assert.equal(detectTreatmentInText("routine checkup, nothing else"), "-");

// Every alias list stays lowercase + normalised, otherwise a lookup silently
// stops matching after someone edits the table.
for (const [column, labels] of Object.entries(META_FIELD_ALIASES)) {
  for (const label of labels) {
    assert.equal(label, normalizeMetaLabel(label), `${column} alias "${label}" must already be normalised`);
  }
}

console.log("✓ all Meta webhook parser assertions passed");
console.log(`  custom treatment question → disease: ${custom.disease}`);
console.log(`  extra answers kept in remarks: ${custom.remarks}`);
