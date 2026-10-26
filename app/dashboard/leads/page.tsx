import Link from "next/link";
import { X } from "lucide-react";

import {
  getLeadsPage,
  getLeadPipelineSummary,
  getDailyWorkCounts,
  getTeamStats,
  getViewer,
} from "@/app/actions/leads";

import { DashboardStats } from "../dashboard-stats";
import {
  describeActiveFilters,
  hasLeadFilters,
  parseLeadFilters,
} from "../lead-filters";
import { LeadsTable } from "../leads-table";
import { TeamOverview } from "../team-overview";
import { AssignmentFilterTabs } from "./assignment-filter-tabs";
import { clinicDate } from "@/lib/attendance";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Drill-down filters come straight from the URL (?stage=&treatment=&age=&city=)
  // so a chart click, a shared link and a page refresh all resolve identically.
  const params = await searchParams;
  const today = clinicDate();
  const parsedFilters = parseLeadFilters(params);
  const filters = parsedFilters;
  const initialOpenLeadId = typeof params.openLead === "string" ? params.openLead : "";
  const isFiltered = hasLeadFilters(filters);
  const activeChips = isFiltered ? describeActiveFilters(filters) : [];

  // Server-side pagination: only the first 50 leads are fetched, counts feed
  // the stat cards so they stay accurate without loading the whole table.
  const [leadsResult, viewerResult, teamResult, employeeSummaryResult] = await Promise.all([
    getLeadsPage(1, 50, filters.q, "", "", filters),
    getViewer(),
    getTeamStats(),
    getLeadPipelineSummary(filters.assigned),
  ]);
  const viewer = viewerResult.success ? viewerResult.data : null;
  const dailyNewLeadsResult = viewer?.role === "employee" ? await getDailyWorkCounts(today) : null;
  const leadsPage = leadsResult.success ? leadsResult.data : { leads: [], total: 0, totalPages: 1 };
  const team = teamResult.success ? teamResult.data : null;
  const canViewAssignments = viewer?.role === "admin" || viewer?.role === "manager";
  const pipelineSummary = employeeSummaryResult.success
    ? employeeSummaryResult.data
    : { total: 0, fresh: 0, followUp: 0, dnp: 0, lost: 0, opdBooked: 0, opdDone: 0, ipdBooked: 0, ipdDone: 0, statuses: {} };
  const cardAssignedTo = viewer?.role === "employee" ? viewer.name : filters.assigned;

  // `counts` is the viewer's whole pipeline (unfiltered), `leadsPage.total` is the
  // filtered result — the difference is what the filters are hiding. When that is
  // the whole pipeline (e.g. 892 leads, 0 shown) the page says so instead of
  // looking like an empty database.
  const totalInScope = pipelineSummary.total;
  const hiddenByFilters = Math.max(totalInScope - leadsPage.total, 0);

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
      <DashboardStats
        summary={pipelineSummary}
        assignedTo={cardAssignedTo}
        dailyNewLeads={viewer?.role === "employee" ? { count: dailyNewLeadsResult?.success ? dailyNewLeadsResult.data.assigned : null, day: today } : undefined}
      />
      {canViewAssignments && team && !filters.assigned && (
        <>
          <AssignmentFilterTabs team={team} filters={filters} />
          <section aria-label="Leads by team member" className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Agent-wise assigned leads</h2>
              <p className="mt-1 text-xs text-slate-500">
                Tap a category to view that agent’s matching leads, or their name to view all assigned leads.
              </p>
            </div>
            <TeamOverview team={team} filters={filters} />
          </section>
        </>
      )}
      {/* "Leads 0" scare: a filtered list (from a chart click or a shared link)
          used to look like an empty database. The banner always states how many
          leads exist and how many the filters are hiding. */}
      {isFiltered && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div>
            <p className="text-sm font-semibold text-amber-900">
              {hiddenByFilters > 0
                ? `${hiddenByFilters.toLocaleString()} of ${totalInScope.toLocaleString()} leads in this selection are hidden by these filters.`
                : "Filters are active on this list."}
            </p>
            <p className="mt-1 text-xs text-amber-800">
              Showing {leadsPage.total.toLocaleString()} matching lead{leadsPage.total === 1 ? "" : "s"} ·{" "}
              {activeChips.join(" · ")}
            </p>
          </div>
          <Link
            href="/dashboard/leads?month=all"
            className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-900 shadow-sm transition-colors hover:bg-amber-100"
          >
            <X className="size-4" aria-hidden="true" />
            Show all {totalInScope.toLocaleString()} leads
          </Link>
        </div>
      )}
      {/* Key remounts on every filter change so the table drops its loaded page
          and refetches page 1 of the new result set. */}
      <section id="lead-list" className="scroll-mt-6" aria-label="Matching leads">
        <LeadsTable
          key={JSON.stringify(filters)}
          leads={leadsPage.leads}
          initialTotal={leadsPage.total}
          initialTotalPages={leadsPage.totalPages}
          initialOpenLeadId={initialOpenLeadId}
          role={viewer?.role ?? "employee"}
          filters={filters}
        />
      </section>
    </div>
  );
}
