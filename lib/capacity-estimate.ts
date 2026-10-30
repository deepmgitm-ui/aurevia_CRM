export interface CapacityEstimateInput {
  databaseBytes: number;
  leadBytes: number;
  activityBytes: number;
  assignmentBytes: number;
  leads: number;
}

/** Illustrative database-only range; actual growth and Supabase quotas vary. */
export function estimateCapacityYears(input: CapacityEstimateInput, leadsPerDay = 100) {
  if (input.leads < 100 || leadsPerDay <= 0) return null;
  const bytesPerLead = (input.leadBytes + input.activityBytes + input.assignmentBytes) / input.leads;
  if (!Number.isFinite(bytesPerLead) || bytesPerLead <= 0) return null;
  const remaining = Math.max(0, 500 * 1024 * 1024 - input.databaseBytes);
  const upperYears = remaining / (bytesPerLead * leadsPerDay * 365);
  return { lowerYears: upperYears / 3, upperYears, bytesPerLead };
}
