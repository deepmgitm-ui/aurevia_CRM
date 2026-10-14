type MetaLeadgenEvent = { leadgenId: string; pageId: string | null };

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

/** Meta webhook deliveries can contain multiple entries and changes. */
export function getLeadgenEvents(payload: unknown): MetaLeadgenEvent[] {
  const root = objectValue(payload);
  if (stringValue(root.object) !== "page") return [];
  const entries = Array.isArray(root.entry) ? root.entry : [];
  return entries.flatMap((entryValue) => {
    const entry = objectValue(entryValue);
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    return changes.flatMap((changeValue) => {
      const change = objectValue(changeValue);
      if (stringValue(change.field) !== "leadgen") return [];
      const value = objectValue(change.value);
      const leadgenId = stringValue(value.leadgen_id);
      return leadgenId ? [{ leadgenId, pageId: stringValue(value.page_id) }] : [];
    });
  });
}
