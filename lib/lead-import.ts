export const LEAD_IMPORT_ALIASES = {
  name: ["full name", "name", "patient name", "patient_name", "patient"],
  phone: [
    "original mobile number",
    "original phone number",
    "mobile number",
    "mobile no",
    "mobile",
    "contact no",
    "phone",
    "phone number",
    "phone_number",
    "contact",
    "contact number",
    "lead phone",
    "whatsapp number",
  ],
  email: ["email", "email address", "email id", "email_id", "mail"],
  gender: ["gender"],
  city: ["campaign city", "city", "location", "area", "address"],
  disease: [
    "patient's query",
    "patients query",
    "disease",
    "treatment",
    "issue",
    "problem",
    "health concern",
    "campaign department",
  ],
  insurance: ["insurance status", "insurance_status", "insurance"],
  remarks: [
    "remarks",
    "remark 1",
    "remark",
    "note",
    "notes",
    "comment",
    "comments",
    "patient confirmation",
    "reason for lost",
  ],
  date: [
    "created time",
    "created at",
    "created_at",
    "date",
    "lead date",
    "lead_date",
    "date of lead",
    "date_of_lead",
    "first touched time",
  ],
  followUpDate: [
    "follow-up date",
    "follow up date",
    "follow_up_date",
    "followup_date",
    "next follow up",
    "next_follow_up",
  ],
  assignedTo: ["lead prospect owner", "assigned to", "assigned_to", "assign to", "assign_to"],
  source: [
    "lead source",
    "lead channel",
    "source",
    "channel",
    "campaign",
    "platform",
    "campaign network",
  ],
  status: ["lead stage status", "lead status", "status", "lead_status"],
} as const;

export type LeadImportField = keyof typeof LEAD_IMPORT_ALIASES;

export const LEAD_IMPORT_PREVIEW_FIELDS: {
  field: LeadImportField;
  label: string;
}[] = [
  { field: "name", label: "Name" },
  { field: "phone", label: "Phone" },
  { field: "email", label: "Email" },
  { field: "city", label: "City" },
  { field: "disease", label: "Disease / treatment" },
  { field: "remarks", label: "Remarks" },
  { field: "date", label: "Lead date" },
  { field: "assignedTo", label: "Assigned to" },
  { field: "source", label: "Source" },
  { field: "status", label: "Status" },
];

export function normalizeLeadImportHeader(value: string): string {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[_\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function findLeadImportValue(
  record: Record<string, unknown>,
  field: LeadImportField,
): unknown {
  const entries = Object.entries(record);
  for (const alias of LEAD_IMPORT_ALIASES[field]) {
    const normalizedAlias = normalizeLeadImportHeader(alias);
    const entry = entries.find(([header]) => normalizeLeadImportHeader(header) === normalizedAlias);
    if (entry) return entry[1];
  }
  return undefined;
}

export function getRecognizedLeadImportFields(headers: string[]): string[] {
  const normalizedHeaders = new Set(headers.map(normalizeLeadImportHeader));
  return LEAD_IMPORT_PREVIEW_FIELDS.filter(({ field }) =>
    LEAD_IMPORT_ALIASES[field].some((alias) =>
      normalizedHeaders.has(normalizeLeadImportHeader(alias)),
    ),
  ).map(({ label }) => label);
}

export function normalizeImportedLeadStatus(value: string): string {
  const normalized = value.trim().toLocaleLowerCase();
  if (normalized === "new lead") return "New";
  if (normalized === "lost") return "Dropped";
  return value.trim();
}
