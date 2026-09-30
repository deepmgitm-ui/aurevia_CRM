// Aurevia CRM — the month half of the lead-age filter.
//
// A client component on purpose: /dashboard/leads is a Server Component (it
// awaits searchParams), so it cannot call useRouter. Picking a month has to
// navigate — it is a filter change, not local state — so the control lives here
// and the server page renders it as a leaf.

"use client";

import { useRouter } from "next/navigation";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { LeadMonthTally } from "@/app/actions/leads";
import { leadsHref, type LeadListFilters } from "../lead-filters";

export function LeadMonthPicker({
  filters,
  months,
}: {
  filters: LeadListFilters;
  months: LeadMonthTally[];
}) {
  const router = useRouter();
  if (months.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="lead-month-picker" className="text-xs font-medium text-slate-600">
        Month
      </label>
      <Select
        value={filters.month || "all"}
        onValueChange={(value) => {
          const month = value && value !== "all" ? value : "";
          // Month and day/week describe the same question, so picking one clears
          // the other instead of intersecting into an empty list.
          router.push(leadsHref({ ...filters, month, age: month ? "" : filters.age }));
        }}
      >
        <SelectTrigger id="lead-month-picker" size="sm" className="w-auto min-w-40 text-xs">
          <SelectValue placeholder="Select month" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All months</SelectItem>
          {months.map((item) => (
            <SelectItem key={item.key} value={item.key}>
              {item.label} · {item.count}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}