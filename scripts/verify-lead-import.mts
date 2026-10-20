import assert from "node:assert/strict";
import { voiceBotTreatment } from "../lib/lead-treatment.ts";

assert.equal(voiceBotTreatment("OPHTHALMOLOGY"), null);
assert.equal(voiceBotTreatment("Voice Bot Details Patient Information : No"), "");
assert.equal(voiceBotTreatment("Voice Bot Details\nPatient City : Virar West\nDetail Treatment : आँखों में से पानी निकलता है\nOpd Confirmation: Yes\nPrior Consultation: No"), "आँखों में से पानी निकलता है");
assert.equal(voiceBotTreatment("Voice Bot Details Detail Treatment: Cataract Patient Confirmation: Yes"), "Cataract");
import {
  cleanImportedLeadRemarks,
  findLeadImportHeaderRow,
  findLeadImportValue,
  getUnmappedLeadImportValues,
  getRecognizedLeadImportFields,
  leadImportGridToRecords,
  normalizeImportedLeadStatus,
} from "../lib/lead-import.ts";
import { canonicalLeadStatus, leadStatusStorageValues } from "../lib/lead-status.ts";

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
assert.equal(normalizeImportedLeadStatus("Won"), "IPD Done");
assert.equal(canonicalLeadStatus("-"), "New");
assert.equal(canonicalLeadStatus("Contacted"), "Follow-Up");
assert.deepEqual(leadStatusStorageValues("IPD Done"), ["IPD Done", "Won", "Surgery Completed"]);
assert.equal(normalizeImportedLeadStatus("Follow Up"), "Follow-Up");
assert.equal(normalizeImportedLeadStatus("Didn't Enquired"), "Didn’t Enquired");
assert.equal(normalizeImportedLeadStatus("Didn’t Enquired"), "Didn’t Enquired");
assert.equal(findLeadImportValue(googleExport, "status"), "New Lead");
assert.equal(findLeadImportValue({ "First Name": "Asha", Surname: "Sharma" }, "name"), "Asha Sharma");
assert.equal(
  findLeadImportValue({ "Original Mobile Number": "", "Phone (WhatsApp)": "+91 9876543210" }, "phone"),
  "+91 9876543210",
);
assert.equal(
  findLeadImportValue({ "Treatment / Procedure Interested In": "LASIK" }, "disease"),
  "LASIK",
);
assert.equal(
  findLeadImportValue({ "Preferred Time": "Evening" }, "remarks"),
  "Evening",
);
assert.equal(
  cleanImportedLeadRemarks("Record Id: zcrm_123 | Lead Stage: Pre OPD | SR Number: 1234567890 | Lead DID: L123 | Called patient, asked to call tomorrow"),
  "Called patient, asked to call tomorrow",
  "CRM export metadata is removed while a human note is kept",
);
assert.equal(
  cleanImportedLeadRemarks("Patient prefers morning calls | Lead Stage: Pre OPD"),
  "Patient prefers morning calls",
);
assert.equal(cleanImportedLeadRemarks("Patient needs a follow-up tomorrow."), "Patient needs a follow-up tomorrow.");
assert.equal(findLeadImportValue({ "Lead Stage": "Pre OPD" }, "status"), undefined);
assert.deepEqual(getUnmappedLeadImportValues({ "Preferred Time": "Evening", "Lead Stage": "Pre OPD" }), [
  "Lead Stage: Pre OPD",
]);
assert.deepEqual(
  getRecognizedLeadImportFields(Object.keys(googleExport)),
  ["Name", "Phone", "City", "Lead date", "Source", "Status"],
);

const titledExport = [
  ["Monthly Leads Export"],
  ["Exported from CRM"],
  ["Patient Name", "WhatsApp Number", "Treatment / Procedure", "Town"],
  ["Asha Sharma", "9876543210", "Cataract", "Pune"],
];
assert.equal(findLeadImportHeaderRow(titledExport), 2);
const parsedTitledRows = leadImportGridToRecords(titledExport);
assert.equal(parsedTitledRows.length, 1);
assert.equal(findLeadImportValue(parsedTitledRows[0], "name"), "Asha Sharma");
assert.equal(findLeadImportValue(parsedTitledRows[0], "phone"), "9876543210");
assert.equal(findLeadImportValue(parsedTitledRows[0], "city"), "Pune");
assert.equal(
  findLeadImportHeaderRow([["Contact Phone", "Date of Registration"], ["9876543210", "11/10/2026"]]),
  0,
  "a phone header is enough to identify a simple header row",
);

console.log("Lead import header mappings verified.");
