import assert from "node:assert/strict";
import {
  findLeadImportValue,
  getRecognizedLeadImportFields,
  normalizeImportedLeadStatus,
} from "../lib/lead-import.ts";

const googleExport = {
  "Full Name": "Test Google Lead",
  "Original Mobile Number": "9876543210",
  "Campaign City": "Pune",
  "Created Time": "2026-01-15 10:30:00",
  "Lead Stage Status": "New Lead",
  "Lead Source": "Web Lead Form",
  "Lead Channel": "Ad - Google",
  "Lead Stage": "Pre OPD",
};

const facebookExport = {
  "Full Name": "Test Facebook Lead",
  "Original Mobile Number": "9876543211",
  "Campaign City": "Mumbai",
  "Created Time": "2026-01-16 11:30:00",
  "Lead Stage Status": "Lost",
  "Lead Source": "Web Lead Form",
  "Lead Channel": "Ad - Facebook",
};

for (const record of [googleExport, facebookExport]) {
  assert.equal(findLeadImportValue(record, "phone"), record["Original Mobile Number"]);
  assert.equal(findLeadImportValue(record, "city"), record["Campaign City"]);
  assert.equal(findLeadImportValue(record, "date"), record["Created Time"]);
  assert.equal(findLeadImportValue(record, "status"), record["Lead Stage Status"]);
  assert.equal(findLeadImportValue(record, "source"), record["Lead Source"]);
}

assert.equal(normalizeImportedLeadStatus("New Lead"), "New");
assert.equal(normalizeImportedLeadStatus("Lost"), "Dropped");
assert.equal(normalizeImportedLeadStatus("Follow Up"), "Follow Up");
assert.equal(findLeadImportValue(googleExport, "status"), "New Lead");
assert.deepEqual(
  getRecognizedLeadImportFields(Object.keys(googleExport)),
  ["Name", "Phone", "City", "Lead date", "Source", "Status"],
);

console.log("Lead import header mappings verified.");
