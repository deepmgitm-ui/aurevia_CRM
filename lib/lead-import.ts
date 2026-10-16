import { canonicalLeadStatus, isLeadStatusOption } from "@/lib/lead-status";

export const LEAD_IMPORT_ALIASES = {
  name: [
    "full name",
    "patient full name",
    "customer full name",
    "lead name",
    "patient name",
    "customer name",
    "client name",
    "contact name",
    "name",
    "patient",
  ],
  firstName: ["first name", "given name", "firstname"],
  lastName: ["last name", "surname", "family name", "lastname"],
  phone: [
    "original mobile number",
    "original phone number",
    "primary phone number",
    "alternate phone number",
    "alternative phone number",
    "telephone number",
    "telephone",
    "whatsapp phone number",
    "whatsapp mobile number",
    "mobile number",
    "mobile no",
    "phone no",
    "phone number 1",
    "phone number",
    "contact phone",
    "contact telephone",
    "contact mobile",
    "contact number 1",
    "mobile",
    "contact no",
    "phone",
    "contact",
    "contact number",
    "lead phone",
    "whatsapp number",
    "whatsapp",
    "tel",
  ],
  email: ["email address", "email id", "e mail", "email", "mail"],
  gender: ["gender", "sex"],
  city: [
    "campaign city",
    "city town",
    "city name",
    "city state",
    "current city",
    "town",
    "district",
    "location",
    "city",
    "area",
    "address",
    "residence",
  ],
  disease: [
    "patient's query",
    "patients query",
    "treatment interested in",
    "interested treatment",
    "treatment required",
    "treatment name",
    "treatment type",
    "service interested in",
    "procedure interested in",
    "medical condition",
    "health concern",
    "eye problem",
    "eye condition",
    "requirement",
    "campaign department",
    "department",
    "disease",
    "treatment",
    "issue",
    "problem",
    "service",
    "procedure",
    "surgery",
    "condition",
    "query",
  ],
  insurance: [
    "insurance status",
    "insurance provider",
    "insurance company",
    "medical insurance",
    "mediclaim",
    "insurance",
  ],
  remarks: [
    "reason for lost",
    "additional information",
    "additional comments",
    "patient confirmation",
    "preferred time",
    "preferred call time",
    "message",
    "description",
    "remarks",
    "remark 1",
    "remark",
    "note",
    "notes",
    "comment",
    "comments",
    "query",
    "other details",
    "other information",
  ],
  date: [
    "created time",
    "created date",
    "submission date",
    "submitted at",
    "lead created date",
    "lead created at",
    "lead created",
    "date created",
    "timestamp",
    "date of inquiry",
    "lead date time",
    "enquiry date",
    "inquiry date",
    "first touched time",
    "created at",
    "created_at",
    "date",
    "lead date",
    "lead_date",
    "date of lead",
    "date_of_lead",
  ],
  followUpDate: [
    "follow-up date",
    "follow up date",
    "follow_up_date",
    "followup_date",
    "next follow up",
    "next_follow_up",
    "callback date",
    "call back date",
    "next contact date",
  ],
  assignedTo: [
    "lead prospect owner",
    "assigned agent",
    "agent",
    "agent name",
    "sales person",
    "salesperson",
    "owner name",
    "assigned to",
    "assigned_to",
    "assign to",
    "assign_to",
  ],
  source: [
    "lead source",
    "lead channel",
    "source name",
    "lead platform",
    "ad platform",
    "campaign source",
    "source",
    "channel",
    "campaign",
    "campaign name",
    "ad name",
    "platform",
    "campaign network",
  ],
  status: [
    "lead stage status",
    "lead status",
    "pipeline stage",
    "enquiry status",
    "inquiry status",
    "status",
    "lead_status",
  ],
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
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/[_\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasValue(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function headerMatchesField(header: string, field: LeadImportField): boolean {
  const normalizedHeader = normalizeLeadImportHeader(header);
  const aliases = LEAD_IMPORT_ALIASES[field];
  if (aliases.some((alias) => normalizeLeadImportHeader(alias) === normalizedHeader)) return true;

  if (field === "date" && /\b(date|time|timestamp)\b/.test(normalizedHeader)) return true;
  if (field === "followUpDate" && /\b(follow up|followup|callback|call back)\b/.test(normalizedHeader)) {
    return true;
  }
  if (
    field === "name" &&
    !/\b(campaign|ad|form|page|account)\b/.test(normalizedHeader) &&
    /\bname\b/.test(normalizedHeader)
  ) return true;
  if (field === "city" && /\b(city|town)\b/.test(normalizedHeader)) return true;
  const fuzzyAliases = field === "name"
    ? [...aliases, ...LEAD_IMPORT_ALIASES.firstName, ...LEAD_IMPORT_ALIASES.lastName]
    : aliases;
  return fuzzyAliases.some((alias) => {
    const normalizedAlias = normalizeLeadImportHeader(alias);
    return normalizedAlias.length >= 5 && normalizedHeader.includes(normalizedAlias);
  });
}

export function findLeadImportValue(
  record: Record<string, unknown>,
  field: LeadImportField,
): unknown {
  const entries = Object.entries(record);
  const matches = (header: string, alias: string) =>
    normalizeLeadImportHeader(header) === normalizeLeadImportHeader(alias);

  for (const alias of LEAD_IMPORT_ALIASES[field]) {
    const entry = entries.find(([header, value]) => matches(header, alias) && hasValue(value));
    if (entry) return entry[1];
  }

  if (field === "name") {
    const firstName = findLeadImportValue(record, "firstName");
    const lastName = findLeadImportValue(record, "lastName");
    const combinedName = [firstName, lastName]
      .filter(hasValue)
      .map((part) => String(part).trim())
      .join(" ");
    if (combinedName) return combinedName;
  }

  for (const [header, value] of entries) {
    if (hasValue(value) && headerMatchesField(header, field)) return value;
  }

  return undefined;
}

export function getUnmappedLeadImportValues(record: Record<string, unknown>): string[] {
  return Object.entries(record)
    .filter(([header, value]) => {
      if (!hasValue(value)) return false;
      return !Object.keys(LEAD_IMPORT_ALIASES).some((field) =>
        headerMatchesField(header, field as LeadImportField),
      );
    })
    .map(([header, value]) => `${header.trim()}: ${String(value).trim()}`);
}

const NON_REMARK_IMPORT_FIELDS = new Set([
  "record id",
  "lead id",
  "lead stage",
  "sr number",
  "sr no",
  "lead did",
  "zcrm id",
]);

/** Keep human notes while removing CRM export metadata copied into Remarks. */
export function cleanImportedLeadRemarks(value: unknown): string {
  if (typeof value !== "string") return "";

  return value
    .split(/\s*\|\s*|\r?\n/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => {
      const colon = chunk.indexOf(":");
      if (colon < 0) return true;
      const label = normalizeLeadImportHeader(chunk.slice(0, colon));
      return !NON_REMARK_IMPORT_FIELDS.has(label);
    })
    .filter(Boolean)
    .join(" | ");
}

export function getRecognizedLeadImportFields(headers: string[]): string[] {
  return LEAD_IMPORT_PREVIEW_FIELDS.filter(({ field }) =>
    headers.some((header) => headerMatchesField(header, field)),
  ).map(({ label }) => label);
}

export function findLeadImportHeaderRow(grid: unknown[][]): number {
  let bestRow = -1;
  let bestScore = 0;
  const scanLimit = Math.min(grid.length, 15);

  for (let index = 0; index < scanLimit; index += 1) {
    const headers = grid[index].map((cell) => String(cell ?? "").trim()).filter(Boolean);
    const recognized = getRecognizedLeadImportFields(headers);
    const hasName = recognized.includes("Name");
    const hasPhone = recognized.includes("Phone");
    const score = recognized.length + Number(hasName) * 2 + Number(hasPhone) * 2;
    const hasIdentityField = recognized.some((field) => ["Name", "Phone", "Email"].includes(field));
    if (score > bestScore && hasIdentityField) {
      bestScore = score;
      bestRow = index;
    }
  }

  return bestScore >= 3 ? bestRow : -1;
}

export function leadImportGridToRecords(grid: unknown[][]): Record<string, unknown>[] {
  const headerRowIndex = findLeadImportHeaderRow(grid);
  if (headerRowIndex < 0) return [];
  const headers = grid[headerRowIndex].map((cell) => String(cell ?? "").trim());

  return grid.slice(headerRowIndex + 1).flatMap((row) => {
    if (row.every((cell) => !hasValue(cell))) return [];
    const record: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      if (header) record[header] = row[index] ?? "";
    });
    return [record];
  });
}

export function normalizeImportedLeadStatus(value: string): string {
  const canonical = canonicalLeadStatus(value);
  return isLeadStatusOption(canonical) ? canonical : "New";
}
