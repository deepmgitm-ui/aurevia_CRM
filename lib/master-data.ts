// Aurevia CRM — master data (picklist) defaults.
//
// ONE PLACE for the dropdown lists the team actually uses (statuses,
// treatments, sources, cities, ...). They live in the DATABASE
// (`crm_option_lists`, seeded by `supabase-master-data-migration.sql`) so an
// admin can change them without a code deploy — this file is only the BOOT
// SEED: when the DB table has no rows yet (or cannot be read), callers fall
// back here, so every select keeps working.
//
// KEEP THESE IN SYNC: STAGE_TARGET_STATUS in
// app/dashboard/overview/analytics.ts uses the canonical stage statuses below.
export const MASTER_DATA_LISTS = ["statuses", "treatments", "sources", "cities", "temperatures"] as const;

export type MasterDataListKey = (typeof MASTER_DATA_LISTS)[number];

/** Seeded values for a brand-new project (or when the table cannot be read). */
export const MASTER_DATA_SEED: Record<MasterDataListKey, string[]> = {
  statuses: [
    "New",
    "Follow Up",
    "Contacted",
    "DNP",
    "DNP 3",
    "RNR",
    "Not Interested",
    "Budget Issue",
    "Location Issue",
    "Non Surgical",
    "Consultation Booked",
    "Consultation Attended",
    "Surgery Completed",
    // Clinic vocabulary. Each of these OWNS A DATE (see lib/appointments.ts):
    // OPD Booked → opd_booked_date, OPD Done → opd_done_date,
    // IPD Done → ipd_done_date. Picking one reveals its date box.
    "OPD Booked",
    "OPD Done",
    "IPD Done",
    "Invalid Number",
    // "Won" is NOT here: it is a computed tag, shown whenever the status is
    // OPD Done / IPD Done / Surgery Completed (see isWonStatus). Storing it as
    // a status too would just be a second thing to keep in sync.
    // "Lost" is gone from the picker — leads that had it were moved to
    // "Dropped" by supabase-master-data-migration.sql, so nothing was lost.
    "Dropped",
  ],
  treatments: ["LASIK", "Cataract", "ICL", "Retina", "Spectacles", "Other"],
  sources: ["Meta Ads", "Online Enquiry", "Agent Referral", "Doctor Referral", "Walk-in", "Corporate Tie-up", "Social Media", "Manual", "Excel/CSV"],
  cities: ["Mumbai", "Pune", "Delhi", "Nagpur", "Thane", "Nashik"],
  temperatures: ["Hot", "Warm", "Cold"],
};

/**
 * A lead-stage status that exists on the BOARD even if an admin deletes it
 * from the list: dropping a card writes one of the stage target statuses, so
 * the board merge logic always offers the current list PLUS these (same
 * round-trip guarantee as `stageForStatus` — see verify:lead-filters).
 */
export const BOARD_FALLBACK_STATUSES = [
  "New",
  "Contacted",
  "Consultation Booked",
  "Consultation Attended",
  "Surgery Completed",
  // "Dropped" rather than "Lost": Lost left the picker (see MASTER_DATA_SEED),
  // and Dropped is what those leads were converted to, so the column still
  // reads every dead lead instead of quietly losing them.
  "Dropped",
] as const;

export interface MasterDataSnapshot {
  lists: Record<MasterDataListKey, string[]>;
  /** True when the snapshot came from the DB (admin edits are live). */
  fromDatabase: boolean;
}

export interface MasterDataResponse {
  success: boolean;
  data?: MasterDataSnapshot;
  error?: string;
}

export interface MasterDataSaveResponse {
  success: boolean;
  error?: string;
}

export const EMPTY_MASTER_DATA: MasterDataSnapshot = {
  lists: { statuses: [], treatments: [], sources: [], cities: [], temperatures: [] },
  fromDatabase: false,
};

/** Seed every list — used when the migration has not been applied yet. */
export function seedMasterData(): MasterDataSnapshot {
  return {
    lists: {
      statuses: [...MASTER_DATA_SEED.statuses],
      treatments: [...MASTER_DATA_SEED.treatments],
      sources: [...MASTER_DATA_SEED.sources],
      cities: [...MASTER_DATA_SEED.cities],
      temperatures: [...MASTER_DATA_SEED.temperatures],
    },
    fromDatabase: false,
  };
}

/**
 * Merge a stored/current value into a list so an already-saved lead always
 * stays selectable, even after an admin removes that option. Never mutates.
 */
export function withCurrentValue(options: readonly string[], current: string | null | undefined): string[] {
  const cleaned = String(current ?? "").trim();
  if (!cleaned || cleaned === "-") return [...options];
  return options.some((option) => option.toLowerCase() === cleaned.toLowerCase())
    ? [...options]
    : [...options, cleaned];
}

/** Merge a whole row set (e.g. statuses found in the DB) with the seed. */
export function mergeMasterDataLists(
  snapshot: MasterDataSnapshot,
  extra: Partial<Record<MasterDataListKey, string[]>>,
): MasterDataSnapshot {
  const lists = { ...snapshot.lists };
  for (const key of MASTER_DATA_LISTS) {
    const additions = extra[key] ?? [];
    const seen = new Set(lists[key].map((value) => value.toLowerCase()));
    for (const value of additions) {
      const cleaned = String(value ?? "").trim();
      if (cleaned && cleaned !== "-" && !seen.has(cleaned.toLowerCase())) {
        seen.add(cleaned.toLowerCase());
        lists[key] = [...lists[key], cleaned];
      }
    }
  }
  return { lists, fromDatabase: snapshot.fromDatabase };
}
