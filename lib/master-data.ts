// Aurevia CRM — master data (picklist) defaults.
//
// Editable dropdown lists (treatments, sources, cities) live in
// `crm_option_lists`. Lead statuses use the fixed clinic workflow below and
// cannot be extended from Settings.
//
// KEEP THESE IN SYNC: STAGE_TARGET_STATUS in
// app/dashboard/overview/analytics.ts uses the canonical stage statuses below.
import { LEAD_STATUS_OPTIONS } from "./lead-status.ts";

export const MASTER_DATA_LISTS = ["statuses", "treatments", "sources", "cities"] as const;

export type MasterDataListKey = (typeof MASTER_DATA_LISTS)[number];

/** Seeded values for a brand-new project (or when the table cannot be read). */
export const MASTER_DATA_SEED: Record<MasterDataListKey, string[]> = {
  statuses: [...LEAD_STATUS_OPTIONS],
  treatments: ["LASIK", "Cataract", "ICL", "Retina", "Spectacles", "Other"],
  sources: ["Meta Ads", "Online Enquiry", "Agent Referral", "Doctor Referral", "Walk-in", "Corporate Tie-up", "Social Media", "Manual", "Excel/CSV"],
  cities: ["Mumbai", "Pune", "Delhi", "Nagpur", "Thane", "Nashik"],
};

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

/** Seed every list — used when the migration has not been applied yet. */
export function seedMasterData(): MasterDataSnapshot {
  return {
    lists: {
      statuses: [...MASTER_DATA_SEED.statuses],
      treatments: [...MASTER_DATA_SEED.treatments],
      sources: [...MASTER_DATA_SEED.sources],
      cities: [...MASTER_DATA_SEED.cities],
    },
    fromDatabase: false,
  };
}
