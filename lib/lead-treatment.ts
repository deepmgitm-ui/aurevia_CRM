/** Read the explicit treatment field from legacy voice-bot summaries.
 * Keep the stored summary intact; confirmations must never become diagnoses.
 */
export function voiceBotTreatment(raw: string): string | null {
  if (!/^\s*voice\s+bot\s+details\b/i.test(raw)) return null;
  const match = raw.match(/\bdetail\s+treatment\s*:\s*([\s\S]*?)(?=\s*\b(?:opd\s+confirmation|prior\s+consultation|patient\s+confirmation|patient\s+city|patient\s+information)\s*:|$)/i);
  return match?.[1]?.trim() ?? "";
}
