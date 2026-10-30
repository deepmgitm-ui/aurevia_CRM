/** The clinic's fixed status vocabulary, shared by every lead editor. */
export const LEAD_STATUS_OPTIONS = [
  "New",
  "Follow-Up",
  "DNP",
  "DNP2",
  "DNP3",
  "RNR",
  "Not Interested",
  "Didn’t Enquired",
  "Budget Issue",
  "Location Issue",
  "Language",
  "Non Surgical",
  "OPD Booked",
  "OPD Done",
  "IPD Done",
  "IPD Booked",
  "Dropped",
  "Invalid Number",
  "CallBack",
  "Wrong Number",
] as const;

const STATUS_ALIASES: Record<string, string> = {
  "follow up": "Follow-Up",
  "follow-up": "Follow-Up",
  contacted: "Follow-Up",
  "dnp 2": "DNP2",
  "dnp 3": "DNP3",
  "not reachable": "RNR",
  "didn't enquired": "Didn’t Enquired",
  "didn’t enquired": "Didn’t Enquired",
  "call back": "CallBack",
  "call back later": "CallBack",
  "consultation booked": "OPD Booked",
  "consultation attended": "OPD Done",
  // Keep old records visible in a valid picker value while new edits use the
  // current fixed workflow. Won remains a derived badge in the UI.
  won: "IPD Done",
  lost: "Dropped",
  "ipd done": "IPD Done",
  "surgery completed": "IPD Done",
  "new lead": "New",
  "-": "New",
  "--": "New",
};

const STATUS_STORAGE_VALUES: Partial<Record<(typeof LEAD_STATUS_OPTIONS)[number], readonly string[]>> = {
  New: ["New Lead", "-", "--"],
  "Follow-Up": ["Follow Up", "Contacted"],
  DNP2: ["DNP 2"],
  DNP3: ["DNP 3"],
  RNR: ["Not Reachable"],
  "Didn’t Enquired": ["Didn't Enquired"],
  CallBack: ["Call Back", "Call Back Later"],
  "OPD Booked": ["Consultation Booked"],
  "OPD Done": ["Consultation Attended"],
  "IPD Done": ["Won", "Surgery Completed"],
  Dropped: ["Lost"],
};

/** Canonicalize legacy spellings into the current fixed workflow. */
export function canonicalLeadStatus(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "New";
  const match = LEAD_STATUS_OPTIONS.find((option) => option.toLowerCase() === raw.toLowerCase());
  return match ?? STATUS_ALIASES[raw.toLowerCase()] ?? raw;
}

export function isLeadStatusOption(value: string | null | undefined): boolean {
  const canonical = canonicalLeadStatus(value);
  return LEAD_STATUS_OPTIONS.some((option) => option === canonical);
}

/** Stored spellings that should match a current status filter/count. */
export function leadStatusStorageValues(value: string | null | undefined): string[] {
  const canonical = canonicalLeadStatus(value);
  return [canonical, ...(STATUS_STORAGE_VALUES[canonical as keyof typeof STATUS_STORAGE_VALUES] ?? [])];
}
