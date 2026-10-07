"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { currentQuarterRange, formatRangeLabel, type DateRange } from "./overview/analytics";

interface DashboardDateRangeValue {
  range: DateRange;
  onChange: (range: DateRange) => void;
}

const DashboardDateRangeContext = createContext<DashboardDateRangeValue | null>(null);

export function DashboardDateRangeProvider({
  value,
  children,
}: {
  value: DashboardDateRangeValue;
  children: ReactNode;
}) {
  return <DashboardDateRangeContext.Provider value={value}>{children}</DashboardDateRangeContext.Provider>;
}

export function DashboardDateRangeControl() {
  const value = useContext(DashboardDateRangeContext);
  if (!value) {
    throw new Error("DashboardDateRangeControl must be rendered inside DashboardDateRangeProvider.");
  }

  const { range, onChange } = value;
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange>(range);
  const [draftSource, setDraftSource] = useState<DateRange>(range);
  if (draftSource.from !== range.from || draftSource.to !== range.to) {
    setDraftSource(range);
    setDraft(range);
  }
  const isValidRange = Boolean(draft.from && draft.to && draft.from <= draft.to);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="flex h-10 items-center gap-2 rounded-xl border border-white/70 bg-white/80 px-3 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-white sm:px-4 sm:text-sm"
            aria-label="Select dashboard date range"
          >
            <CalendarDays className="size-4 shrink-0 text-slate-500" aria-hidden="true" />
            <span className="whitespace-nowrap">{formatRangeLabel(range)}</span>
            <ChevronDown className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
          </button>
        }
      />
      <PopoverContent className="w-72 space-y-3" align="end">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="greeting-range-from">From</Label>
            <Input
              id="greeting-range-from"
              type="date"
              value={draft.from}
              max={draft.to || undefined}
              onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="greeting-range-to">To</Label>
            <Input
              id="greeting-range-to"
              type="date"
              value={draft.to}
              min={draft.from || undefined}
              onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))}
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              const quarter = currentQuarterRange();
              setDraft(quarter);
              onChange(quarter);
              setIsOpen(false);
            }}
          >
            This quarter
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!isValidRange}
            onClick={() => {
              onChange(draft);
              setIsOpen(false);
            }}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
