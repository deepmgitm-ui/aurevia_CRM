"use client";

import { useId, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { buildMonthCells } from "./month-grid";

const MONTHS = Array.from({ length: 12 }, (_, index) =>
  new Intl.DateTimeFormat("en", { month: "long" }).format(new Date(2026, index, 1)),
);
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function monthKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function formatDate(value: string): string {
  if (!value) return "Select date";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return "Select date";
  return new Date(year, month - 1, day).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function AppointmentDatePicker({
  value,
  label,
  hint,
  disabled = false,
  onChange,
}: {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const today = new Date();
  const id = useId();
  const selected = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const selectedYear = selected ? Number(selected[1]) : today.getFullYear();
  const selectedMonth = selected ? Number(selected[2]) - 1 : today.getMonth();
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => monthKey(selectedYear, selectedMonth));
  const [cursorYear, cursorMonth] = cursor.split("-").map(Number);
  const cells = useMemo(() => buildMonthCells(cursor), [cursor]);
  const currentYear = today.getFullYear();
  const firstYear = Math.min(currentYear - 10, selectedYear);
  const lastYear = Math.max(currentYear + 20, selectedYear);
  const years = Array.from(
    { length: lastYear - firstYear + 1 },
    (_, index) => firstYear + index,
  );

  function shiftMonth(delta: number) {
    const date = new Date(cursorYear, cursorMonth - 1 + delta, 1);
    setCursor(monthKey(date.getFullYear(), date.getMonth()));
  }

  function updateMonth(month: number) {
    setCursor(monthKey(cursorYear, month));
  }

  function updateYear(year: number) {
    setCursor(monthKey(year, cursorMonth - 1));
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (disabled && nextOpen) return;
        if (nextOpen) {
          setCursor(monthKey(selectedYear, selectedMonth));
        }
        setOpen(nextOpen);
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            disabled={disabled}
            aria-label={`${label}: ${formatDate(value)}`}
            aria-haspopup="dialog"
            title={hint}
            className="flex h-8 w-full max-w-[190px] items-center justify-between gap-1 rounded-md border border-slate-200 bg-white px-2 text-left text-[11px] text-slate-700 hover:border-blue-300 focus-visible:border-blue-500 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className={value ? "" : "text-slate-400"}>{formatDate(value)}</span>
            <CalendarDays className="size-3.5 shrink-0 text-slate-500" aria-hidden="true" />
          </button>
        }
      />
      <PopoverContent className="w-[min(20rem,calc(100vw-2rem))] space-y-3 p-3" align="start">
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            size="icon"
            variant="outline"
            aria-label="Previous month"
            onClick={() => shiftMonth(-1)}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <div className="flex min-w-0 flex-1 gap-2">
            <select
              id={`${id}-month`}
              aria-label={`${label} month`}
              value={cursorMonth - 1}
              onChange={(event) => updateMonth(Number(event.target.value))}
              className="h-9 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 text-sm"
            >
              {MONTHS.map((month, index) => (
                <option key={month} value={index}>{month}</option>
              ))}
            </select>
            <select
              id={`${id}-year`}
              aria-label={`${label} year`}
              value={cursorYear}
              onChange={(event) => updateYear(Number(event.target.value))}
              className="h-9 w-24 rounded-md border border-slate-200 bg-white px-2 text-sm"
            >
              {years.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>
          <Button
            type="button"
            size="icon"
            variant="outline"
            aria-label="Next month"
            onClick={() => shiftMonth(1)}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-slate-500">
          {WEEKDAYS.map((weekday) => <span key={weekday}>{weekday}</span>)}
        </div>
        <div className="grid grid-cols-7 gap-1" role="grid" aria-label={cursor}>
          {cells.map((cell) => {
            const isSelected = cell.iso === value;
            const isToday = cell.iso === [
              currentYear,
              String(today.getMonth() + 1).padStart(2, "0"),
              String(today.getDate()).padStart(2, "0"),
            ].join("-");
            return (
              <button
                key={cell.iso}
                type="button"
                aria-label={new Date(`${cell.iso}T00:00:00`).toLocaleDateString("en", {
                  weekday: "long",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
                aria-pressed={isSelected}
                onClick={() => {
                  onChange(cell.iso);
                  setCursor(cell.iso.slice(0, 7));
                  setOpen(false);
                }}
                className={`flex h-9 items-center justify-center rounded-md text-sm transition-colors ${
                  isSelected
                    ? "bg-blue-600 font-semibold text-white"
                    : isToday
                      ? "border border-blue-300 font-semibold text-blue-700"
                      : cell.isCurrentMonth
                        ? "text-slate-800 hover:bg-slate-100"
                        : "text-slate-400 hover:bg-slate-100"
                }`}
              >
                {cell.day}
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 pt-2">
          <span className="text-xs text-slate-500">{label}</span>
          <div className="flex gap-2">
            {value && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
              >
                Clear
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                const date = [
                  currentYear,
                  String(today.getMonth() + 1).padStart(2, "0"),
                  String(today.getDate()).padStart(2, "0"),
                ].join("-");
                onChange(date);
                setCursor(date.slice(0, 7));
                setOpen(false);
              }}
            >
              Today
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
