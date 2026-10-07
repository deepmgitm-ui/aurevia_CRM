// Pure month-grid math lives here so the "use server" actions file stays free
// of non-async exports (Next forbids them) AND the verifier can… well, the
// verifier still keeps its own spec copy (see scripts/verify-calendar.mts) —
// this copy is the single runtime source of truth for the app itself.
export function buildMonthCells(month: string): { iso: string; day: number; isCurrentMonth: boolean }[] {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  if (!year || monthIndex < 0 || monthIndex > 11) throw new Error("Month must look like 2026-09.");
  const first = new Date(year, monthIndex, 1);
  // Monday-first offset: Sunday (0) starts the row 6 days back.
  const leadDays = (first.getDay() + 6) % 7;
  const start = new Date(year, monthIndex, 1 - leadDays);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    return {
      iso: toLocalIso(date),
      day: date.getDate(),
      isCurrentMonth: date.getMonth() === monthIndex,
    };
  });
}

/** Treat optional calendar lists as empty rather than crashing while rendering. */
export function ensureArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

/** Local-calender yyyy-mm-dd (no UTC shift — the grid must match wall dates). */
export function toLocalIso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}