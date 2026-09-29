import Link from "next/link";
import { X } from "lucide-react";

import { getLeadCounts, getLeadsPage, getTreatmentTally, getViewer, type LeadCounts } from "@/app/actions/leads";

import { DashboardStats } from "../dashboard-stats";
import {
  AGE_BUCKETS,
  describeActiveFilters,
  hasLeadFilters,
  leadsHref,
  parseLeadFilters,
  type LeadListFilters,
  type TreatmentTally,
} from "../lead-filters";
import { LeadsTable } from "../leads-table";
import { treatmentColor } from "../overview/analytics";

/**
 * Treatment-wise strip: "konsa lead kis treatment / disease ka hai" — one chip
 * per treatment for the current selection, each a one-click filter toggle, so the
 * table below can always be narrowed to LASIK / Cataract / Retina / … instantly.
 */
function TreatmentBreakdown({
  tally,
  filters,
}: {
  tally: TreatmentTally[];
  filters: LeadListFilters;
}) {
  if (tally.length === 0) return null;
  const total = tally.reduce((sum, item) => sum + item.count, 0);

  return (
    <section
      aria-label="Treatment-wise leads"
      className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Treatment-wise breakdown</h2>
        <p className="text-xs text-slate-500">
          {total.toLocaleString()} lead{total === 1 ? "" : "s"} in this selection · click a treatment to open
          its leads
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {tally.map(({ key, label, count }) => {
          const active = filters.treatment === key;
          return (
            <Link
              key={key}
              href={leadsHref({ ...filters, treatment: active ? "" : key, except: "" })}
              aria-pressed={active}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? "border-blue-300 bg-blue-50 text-blue-800"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50"
              }`}
            >
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: treatmentColor(key) }}
                aria-hidden="true"
              />
              {label}
              <span className={active ? "text-blue-700/80" : "text-slate-400"}>{count.toLocaleString()}</span>
              {active && <X className="size-3" aria-hidden="true" />}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Age strip: how fresh the leads in view are — Today → Yesterday → 2..6 days →
 * 1/2/3 weeks → Older, the exact ladder the team asked for.
 */
function AgeStrip({ filters }: { filters: LeadListFilters }) {
  return (
    <section aria-label="Lead age" className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">How old are these leads?</h2>
      <div className="flex flex-wrap gap-2">
        <Link
          href={leadsHref({ ...filters, age: "" })}
          aria-pressed={!filters.age}
          className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
            !filters.age
              ? "border-blue-300 bg-blue-50 text-blue-800"
              : "border-slate-200 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50"
          }`}
        >
          All time
        </Link>
        {AGE_BUCKETS.map((bucket) => {
          const active = filters.age === bucket.key;
          return (
            <Link
              key={bucket.key}
              href={leadsHref({ ...filters, age: active ? "" : bucket.key })}
              aria-pressed={active}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? "border-blue-300 bg-blue-50 text-blue-800"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50"
              }`}
            >
              {bucket.label}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Drill-down filters come straight from the URL (?stage=&treatment=&age=&city=)
  // so a chart click, a shared link and a page refresh all resolve identically.
  const filters = parseLeadFilters(await searchParams);
  const isFiltered = hasLeadFilters(filters);
  const activeChips = isFiltered ? describeActiveFilters(filters) : [];

  // Server-side pagination: only the first 50 leads are fetched, counts feed
  // the stat cards so they stay accurate without loading the whole table.
  const [leadsResult, countsResult, tallyResult, viewerResult] = await Promise.all([
    getLeadsPage(1, 50, filters.q, "", "", filters),
    getLeadCounts(),
    getTreatmentTally(filters),
    getViewer(),
  ]);
  const viewer = viewerResult.success ? viewerResult.data : null;
  const leadsPage = leadsResult.success ? leadsResult.data : { leads: [], total: 0, totalPages: 1 };
  const counts: LeadCounts = countsResult.success
    ? countsResult.data
    : { total: 0, new: 0, hot: 0, won: 0, lost: 0 };
  const tally = tallyResult.success ? tallyResult.data : [];

  // `counts` is the viewer's whole pipeline (unfiltered), `leadsPage.total` is the
  // filtered result — the difference is what the filters are hiding. When that is
  // the whole pipeline (e.g. 892 leads, 0 shown) the page says so instead of
  // looking like an empty database.
  const hiddenByFilters = Math.max(counts.total - leadsPage.total, 0);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
          {isFiltered ? "Filtered Leads" : "All Leads"}
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          {isFiltered
            ? `Showing leads matching ${activeChips.join(" · ")}.`
            : "Review and manage every lead in your pipeline."}
        </p>
      </div>
      <DashboardStats counts={counts} />
      {/* "Leads 0" scare: a filtered list (from a chart click or a shared link)
          used to look like an empty database. The banner always states how many
          leads exist and how many the filters are hiding. */}
      {isFiltered && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div>
            <p className="text-sm font-semibold text-amber-900">
              {hiddenByFilters > 0
                ? `${hiddenByFilters.toLocaleString()} of your ${counts.total.toLocaleString()} leads are hidden by these filters.`
                : "Filters are active on this list."}
            </p>
            <p className="mt-1 text-xs text-amber-800">
              Showing {leadsPage.total.toLocaleString()} matching lead{leadsPage.total === 1 ? "" : "s"} ·{" "}
              {activeChips.join(" · ")}
            </p>
          </div>
          <Link
            href="/dashboard/leads"
            className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-900 shadow-sm transition-colors hover:bg-amber-100"
          >
            <X className="size-4" aria-hidden="true" />
            Show all {counts.total.toLocaleString()} leads
          </Link>
        </div>
      )}
      <TreatmentBreakdown tally={tally} filters={filters} />
      <AgeStrip filters={filters} />
      {/* Key remounts on every filter change so the table drops its loaded page
          and refetches page 1 of the new result set. */}
      <LeadsTable
        key={JSON.stringify(filters)}
        leads={leadsPage.leads}
        initialTotal={leadsPage.total}
        initialTotalPages={leadsPage.totalPages}
        role={viewer?.role ?? "employee"}
        filters={filters}
      />
    </div>
  );
}
