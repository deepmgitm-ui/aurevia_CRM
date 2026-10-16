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
  "Non Surgical",
  "OPD Booked",
  "OPD Done",
  "IPD Booked",
  "Won",
  "Lost",
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
  "ipd done": "Won",
  "surgery completed": "Won",
  dropped: "Lost",
  "new lead": "New",
};

/** Canonicalize legacy spellings without inventing a new status. */
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
