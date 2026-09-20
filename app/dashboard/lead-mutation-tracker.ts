// Tracks lead IDs mutated by THIS browser session so realtime notifications
// can suppress toasts for changes the admin made themselves. The leads table
// has no updated_by column, so this client-side signal is the reliable way to
// distinguish "my own edit" from "a teammate's edit".
const recentMutations = new Map<string, number>();

const PRUNE_AFTER_MS = 60_000;

export function trackLeadMutations(ids: string | string[]): void {
  const list = Array.isArray(ids) ? ids : [ids];
  const now = Date.now();
  for (const id of list) {
    if (id) recentMutations.set(id, now);
  }
  // Keep the map tiny on long sessions.
  for (const [id, timestamp] of recentMutations) {
    if (now - timestamp > PRUNE_AFTER_MS) recentMutations.delete(id);
  }
}

export function isRecentSelfMutation(leadId: string, windowMs = 15_000): boolean {
  const timestamp = recentMutations.get(leadId);
  return timestamp !== undefined && Date.now() - timestamp < windowMs;
}