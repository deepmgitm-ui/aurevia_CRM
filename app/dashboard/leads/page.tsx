import { getLeadCounts, getLeadsPage, getViewer, type LeadCounts } from "@/app/actions/leads";

import { DashboardStats } from "../dashboard-stats";
import { describeActiveFilters, hasLeadFilters, parseLeadFilters } from "../lead-filters";
import { LeadsTable } from "../leads-table";

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
  const [leadsResult, countsResult, viewerResult] = await Promise.all([
    getLeadsPage(1, 50, filters.q, "", "", filters),
    getLeadCounts(),
    getViewer(),
  ]);
  const viewer = viewerResult.success ? viewerResult.data : null;
  const leadsPage = leadsResult.success ? leadsResult.data : { leads: [], total: 0, totalPages: 1 };
  const counts: LeadCounts = countsResult.success
    ? countsResult.data
    : { total: 0, new: 0, hot: 0, won: 0, lost: 0 };

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
