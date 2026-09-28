"use client";

// ---------------------------------------------------------------------------
// Filter row: City · Lead Source · Treatment Type · Agent Name · Lead Date
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Calendar, ChevronDown, Eye, MapPin, Megaphone, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { ALL_FILTER_VALUE, type DashboardFilters, type FilterOptions } from "./analytics";

interface FilterBarProps {
  filters: DashboardFilters;
  options: FilterOptions;
  isSample: boolean;
  onChange: (key: keyof DashboardFilters, value: string) => void;
  onReset: () => void;
}

/** ISO yyyy-mm-dd → dd/mm/yyyy (the format used by the reference design). */
export function displayDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "—";
}

function FilterLabel({ icon: Icon, children }: { icon: typeof MapPin; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
      <Icon className="size-3.5 text-slate-500" aria-hidden="true" />
      {children}
    </span>
  );
}

function FilterSelect({
  label,
  icon,
  value,
  options,
  onChange,
}: {
  label: string;
  icon: typeof MapPin;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <FilterLabel icon={icon}>{label}</FilterLabel>
      <Select value={value} onValueChange={(next) => onChange(typeof next === "string" ? next : ALL_FILTER_VALUE)}>
        <SelectTrigger
          className="h-10 w-full rounded-lg border-slate-200 bg-white px-3 text-sm text-slate-700"
          aria-label={`Filter by ${label}`}
        >
          <SelectValue placeholder="All" />
        </SelectTrigger>
        <SelectContent className="max-h-72 overflow-y-auto">
          <SelectItem value={ALL_FILTER_VALUE}>All</SelectItem>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function FilterBar({ filters, options, isSample, onChange, onReset }: FilterBarProps) {
  const [isDateOpen, setIsDateOpen] = useState(false);
  const hasActiveFilters =
    filters.city !== ALL_FILTER_VALUE ||
    filters.source !== ALL_FILTER_VALUE ||
    filters.treatment !== ALL_FILTER_VALUE ||
    filters.agent !== ALL_FILTER_VALUE;

  return (
    <section aria-label="Dashboard filters" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <FilterSelect
          label="City"
          icon={MapPin}
          value={filters.city}
          options={options.cities}
          onChange={(value) => onChange("city", value)}
        />
        <FilterSelect
          label="Lead Source"
          icon={Megaphone}
          value={filters.source}
          options={options.sources}
          onChange={(value) => onChange("source", value)}
        />
        <FilterSelect
          label="Treatment Type"
          icon={Eye}
          value={filters.treatment}
          options={options.treatments}
          onChange={(value) => onChange("treatment", value)}
        />
        <FilterSelect
          label="Agent Name"
          icon={User}
          value={filters.agent}
          options={options.agents}
          onChange={(value) => onChange("agent", value)}
        />

        <div className="flex min-w-0 flex-col gap-2">
          <FilterLabel icon={Calendar}>Lead Date</FilterLabel>
          <Popover open={isDateOpen} onOpenChange={setIsDateOpen}>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  className="flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 transition-colors hover:bg-slate-50"
                  aria-label="Filter by lead date range"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Calendar className="size-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                    <span className="truncate">
                      {displayDate(filters.from)} - {displayDate(filters.to)}
                    </span>
                  </span>
                  <ChevronDown className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
                </button>
              }
            />
            <PopoverContent className="w-72 space-y-3" align="end">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="dashboard-filter-from">From</Label>
                  <Input
                    id="dashboard-filter-from"
                    type="date"
                    value={filters.from}
                    onChange={(event) => onChange("from", event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dashboard-filter-to">To</Label>
                  <Input
                    id="dashboard-filter-to"
                    type="date"
                    value={filters.to}
                    onChange={(event) => onChange("to", event.target.value)}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onChange("from", "");
                    onChange("to", "");
                  }}
                >
                  Clear dates
                </Button>
                <Button type="button" size="sm" onClick={() => setIsDateOpen(false)}>
                  Done
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {(hasActiveFilters || isSample) && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
          <p className="text-xs text-slate-500">
            {isSample
              ? "Preview data: the leads table is empty, so the designed sample figures are shown. Import leads and every card switches to live numbers automatically."
              : "Filters apply to the KPIs, charts and agent stats on this dashboard."}
          </p>
          {hasActiveFilters && (
            <Button type="button" variant="outline" size="sm" onClick={onReset}>
              Reset filters
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

