/** Trigger a complete local JSON backup before its matching lead deletion. */
export async function downloadLeadJsonBackup<Lead extends object, Activity extends object>(
  leads: Lead[],
  activities: Activity[],
  fileName: string,
): Promise<void> {
  const payload = {
    format: "aurevia-crm-lead-backup/v1",
    exported_at: new Date().toISOString(),
    lead_count: leads.length,
    activity_count: activities.length,
    leads,
    activity_history: activities,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName.toLowerCase().endsWith(".json") ? fileName : `${fileName}.json`;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  // Let the browser start the download before the caller sends its delete request.
  await new Promise<void>((resolve) => window.setTimeout(resolve, 1_000));
  URL.revokeObjectURL(url);
}
