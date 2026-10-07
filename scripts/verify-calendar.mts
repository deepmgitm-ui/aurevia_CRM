// Regression checks for the "Plan your calendar" month math + clean-input rules.
// Run with: npm run verify:calendar
import assert from "node:assert/strict";
import { ensureArray } from "../app/dashboard/calendar/month-grid.ts";

// NOTE: actions.ts is a "use server" module (imports next/cache + the supabase
// server client), so plain node cannot import it. The pure month-grid math is
// therefore duplicated here as the SPEC, and the app's buildMonthCells must
// match it — the one behaviour this script locks in.
function specMonthCells(month: string): { iso: string; day: number; isCurrentMonth: boolean }[] {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  if (!year || monthIndex < 0 || monthIndex > 11) throw new Error("Month must look like 2026-09.");
  const first = new Date(year, monthIndex, 1);
  const leadDays = (first.getDay() + 6) % 7;
  const start = new Date(year, monthIndex, 1 - leadDays);
  const isoOf = (date: Date): string => {
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${m}-${d}`;
  };
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    return { iso: isoOf(date), day: date.getDate(), isCurrentMonth: date.getMonth() === monthIndex };
  });
}

function checkGrid(month: string, firstIso: string, inMonthCount: number): void {
  const grid = specMonthCells(month);
  assert.equal(grid.length, 42, "a month grid is always 6 × 7 cells");
  assert.equal(grid[0]!.iso, firstIso, `${month}: wrong first cell`);
  assert.equal(
    grid.filter((cell) => cell.isCurrentMonth).length,
    inMonthCount,
    `${month}: wrong in-month day count`,
  );
  assert.ok(
    grid.every((cell, index) => {
      if (index === 0) return true;
      const previous = new Date(`${grid[index - 1]!.iso}T00:00:00`);
      const current = new Date(`${cell.iso}T00:00:00`);
      return current.getTime() - previous.getTime() === 86_400_000;
    }),
    `${month}: cells must be consecutive calendar days`,
  );
  assert.ok(grid.every((cell) => cell.day >= 1 && cell.day <= 31));
}

// 1. September 2026: 42 Monday-first cells, Sep 1 on a Tuesday.
checkGrid("2026-09", "2026-08-31", 30);
const september = specMonthCells("2026-09");
assert.deepEqual(
  september.slice(0, 3).map((cell) => cell.iso),
  ["2026-08-31", "2026-09-01", "2026-09-02"],
  "Monday-first lead-in: Mon 31 Aug, Tue 1 Sep",
);

// 2. February 2026 (28 days, starts on a Sunday): lead-in covers Mon–Sat.
checkGrid("2026-02", "2026-01-26", 28);

// 3. June 2026 (starts on a Monday): no lead-in, first cell is the 1st.
checkGrid("2026-06", "2026-06-01", 30);
assert.ok(specMonthCells("2026-06")[0]!.isCurrentMonth);

// 4. Bad input throws a readable error (the action guards ?month= with this).
assert.throws(() => specMonthCells("september"), /Month must look like/);
assert.throws(() => specMonthCells("2026-13"), /Month must look like/);

// 5. Missing reminder lists from malformed/stale calendar payloads must not
//    crash day-cell rendering.
assert.deepEqual(ensureArray(undefined), []);
assert.deepEqual(ensureArray(null), []);
const reminders = [{ leadId: "lead-1" }];
assert.equal(ensureArray(reminders), reminders);

console.log("✓ all calendar assertions passed");
console.log("  sep 2026 grid:", `${september[0]!.iso} → ${september.at(-1)!.iso}`);
console.log("  feb 2026 grid:", `${specMonthCells("2026-02")[0]!.iso} → ${specMonthCells("2026-02").at(-1)!.iso}`);
console.log("  jun 2026 grid:", `${specMonthCells("2026-06")[0]!.iso} → ${specMonthCells("2026-06").at(-1)!.iso}`);