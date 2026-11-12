import Link from "next/link";

import { LEAD_STATUS_OPTIONS } from "@/lib/lead-status";
import type { LeadListFilters } from "../lead-filters";

const BUCKET_OPTIONS = [
  ["new", "New · waiting for first contact"],
  ["fresh", "Fresh · untouched 24 hours or more"],
  ["followup", "Follow Up Work"],
  ["opdBooked", "OPD Booked"],
  ["opdDone", "OPD Done"],
  ["ipdBooked", "IPD Booked"],
  ["ipdDone", "Converted / Won"],
  ["dnp", "DNP"],
  ["lost", "Lost"],
] as const;

const FILTER_KEYS = new Set([
  "name",
  "bucket",
  "status",
  "treatment",
  "disease",
  "except",
  "page",
  "openLead",
]);

type SearchParams = Record<string, string | string[] | undefined>;

function preservedEntries(params: SearchParams): Array<[string, string]> {
  return Object.entries(params).flatMap(([key, value]) => {
    if (FILTER_KEYS.has(key) || value === undefined) return [];
    return (Array.isArray(value) ? value : [value]).map((item) => [key, item] as [string, string]);
  });
}

function fieldClassName() {
  return "mt-1 block min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus-visible:border-blue-600 focus-visible:ring-2 focus-visible:ring-blue-600/20";
}

export function GlobalLeadFilters({
  filters,
  params,
}: {
  filters: LeadListFilters;
  params: SearchParams;
}) {
  const carried = preservedEntries(params);
  const dispositionOptions = filters.status && !LEAD_STATUS_OPTIONS.includes(filters.status as (typeof LEAD_STATUS_OPTIONS)[number])
    ? [filters.status, ...LEAD_STATUS_OPTIONS]
    : LEAD_STATUS_OPTIONS;

  return (
    <section aria-labelledby="global-lead-filters-title" className="rounded-2xl border border-blue-950/[0.08] bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4">
        <h2 id="global-lead-filters-title" className="text-sm font-semibold text-slate-900">Global lead filters</h2>
        <p className="mt-1 text-xs text-slate-500">Filter the full lead list by identity, workflow stage, disposition, treatment, or disease.</p>
      </div>
      <form action="/dashboard/leads" method="get" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {carried.map(([key, value], index) => <input key={`${key}-${index}`} type="hidden" name={key} value={value} />)}
        <label className="text-xs font-medium text-slate-700">
          Name
          <input className={fieldClassName()} type="search" name="name" maxLength={120} defaultValue={filters.name} placeholder="Search by name" />
        </label>
        <label className="text-xs font-medium text-slate-700">
          Lead status
          <select className={fieldClassName()} name="bucket" defaultValue={filters.bucket}>
            <option value="">All lead stages</option>
            {BUCKET_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-700">
          Disposition
          <select className={fieldClassName()} name="status" defaultValue={filters.status}>
            <option value="">All dispositions</option>
            {dispositionOptions.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-700">
          Treatment type
          <input className={fieldClassName()} type="search" name="treatment" maxLength={120} defaultValue={filters.treatment} placeholder="e.g. LASIK, cataract" />
        </label>
        <label className="text-xs font-medium text-slate-700">
          Disease
          <input className={fieldClassName()} type="search" name="disease" maxLength={120} defaultValue={filters.disease} placeholder="Search disease" />
        </label>
        <div className="flex items-end gap-2 sm:col-span-2 xl:col-span-5">
          <button type="submit" className="min-h-10 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">
            Apply filters
          </button>
          <Link href="/dashboard/leads?month=all" className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">
            Clear filters
          </Link>
        </div>
      </form>
    </section>
  );
}
