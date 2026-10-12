export const CALL_OUTCOMES = [
  "Connected",
  "No Answer",
  "Call Back Later",
  "Switched Off",
  "Not Reachable",
  "Wrong Number",
  "Not Interested",
] as const;
export function normaliseCallOutcome(value: string): string | null {
  const legacy: Record<string, string> = {
    DNP: "No Answer",
    RNR: "No Answer",
    Interested: "Connected",
    "Requested Callback": "Call Back Later",
  };
  const outcome = legacy[value] ?? value;
  return (CALL_OUTCOMES as readonly string[]).includes(outcome)
    ? outcome
    : null;
}
export function isCallTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
