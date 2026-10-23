import Link from "next/link";
import { X } from "lucide-react";

import {
  getLeadCounts,
  getLeadMonthTally,
  getLeadsPage,
  getLeadPipelineSummary,
  getDailyWorkCounts,
  getTeamStats,
  getViewer,
  type LeadCounts,
  type LeadMonthTally,
} from "@/app/actions/leads";
import { LeadMonthPicker } from "./lead-month-picker";

import { DashboardStats } from "../dashboard-stats";
import {
  AGE_CHIP_BUCKETS,
  describeActiveFilters,
  hasLeadFilters,
  leadsHref,
  monthFilterLabel,
  parseLeadFilters,
  type LeadListFilters,
} from "../lead-filters";
import { LeadsTable } from "../leads-table";
import { TeamOverview } from "../team-overview";
import { AssignmentFilterTabs } from "./assignment-filter-tabs";
import { clinicDate } from "@/lib/attendance";

/**
 * Age strip: how fresh the leads in view are — Today → 1 day ago → 2..7 days →
 * 1/2/3 weeks, then a MONTH picker.
 *
 * The month picker replaces the old vague "Month" chip: instead of one bucket
 * labelled "older", the team picks the actual month (Mar 2026, Apr 2026, …) from
 * a list built out of the months that really hold leads. Choosing a month clears
 * the age chip and vice versa, since "today" and "Mar 2026" are alternatives,
 * not something to intersect.
 */
function AgeStrip({
  filters,
  months,
  currentMonth,
}: {
  filters: LeadListFilters;
  months: LeadMonthTally[];
  currentMonth: string;
}) {
  // A month already covers every day, so the day/week chips would be noise.
  const ageLocked = filters.month.length > 0;

  return (
    <section
      aria-label="Lead age"
      className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">How old are these leads?</h2>
        {/* Client leaf: this page is a Server Component, so the navigating
            dropdown lives in its own file. */}
        <LeadMonthPicker filters={filters} months={months} currentMonth={currentMonth} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Link
          href={leadsHref({ ...filters, age: "", month: "", allMonths: true })}
          aria-pressed={filters.allMonths}
          className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
            !filters.age && !ageLocked
              ? "border-blue-300 bg-blue-50 text-blue-800"
              : "border-slate-200 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50"
          }`}
        >
          All time
        </Link>
        {AGE_CHIP_BUCKETS.map((bucket) => {
          const active = filters.age === bucket.key;
          return (
            <Link
              key={bucket.key}
              // Picking a day/week drops the month: they describe the same
              // "how old is this lead" question two different ways.
              href={leadsHref({ ...filters, age: active ? "" : bucket.key, month: "", allMonths: false })}
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
      {ageLocked && (
        <p className="text-xs text-slate-500">
          Showing leads for {monthFilterLabel(filters.month)} — the day and week filters do
          not apply alongside it.
        </p>
      )}
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
  const params = await searchParams;
  const today = clinicDate();
  const currentMonth = today.slice(0, 7);
  const parsedFilters = parseLeadFilters(params);
  const filters = Object.keys(params).length === 0 && !parsedFilters.age && !parsedFilters.allMonths
    ? { ...parsedFilters, month: currentMonth }
    : parsedFilters;
  const initialOpenLeadId = typeof params.openLead === "string" ? params.openLead : "";
  const isFiltered = hasLeadFilters(filters);
  const activeChips = isFiltered ? describeActiveFilters(filters) : [];

  // Server-side pagination: only the first 50 leads are fetched, counts feed
  // the stat cards so they stay accurate without loading the whole table.
  const [leadsResult, countsResult, viewerResult, monthsResult, teamResult, employeeSummaryResult] = await Promise.all([
    getLeadsPage(1, 50, filters.q, "", "", filters),
    getLeadCounts(),
    getViewer(),
    // Month picker options: the months that really hold leads, so picking one
    // can never land on an empty list.
    getLeadMonthTally(),
    getTeamStats(),
    getLeadPipelineSummary(filters.assigned),
  ]);
  const viewer = viewerResult.success ? viewerResult.data : null;
  const dailyNewLeadsResult = viewer?.role === "employee" ? await getDailyWorkCounts(today) : null;
  const leadsPage = leadsResult.success ? leadsResult.data : { leads: [], total: 0, totalPages: 1 };
  const counts: LeadCounts = countsResult.success
    ? countsResult.data
    : { total: 0, new: 0, followUp: 0, won: 0, lost: 0 };
  const months: LeadMonthTally[] = monthsResult.success ? monthsResult.data : [];
  const team = teamResult.success ? teamResult.data : null;
  const canViewAssignments = viewer?.role === "admin" || viewer?.role === "manager";
  const pipelineSummary = employeeSummaryResult.success
    ? employeeSummaryResult.data
    : { total: 0, fresh: 0, followUp: 0, dnp: 0, lost: 0, opdBooked: 0, opdDone: 0, ipdBooked: 0, ipdDone: 0 };
  const cardAssignedTo = viewer?.role === "employee" ? viewer.name : filters.assigned;

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
                ? `${hiddenByFilters.toLocaleString()} of your ${counts.total.toLocaleString()} leads are hidden by these filters.`
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
            Show all {counts.total.toLocaleString()} leads
          </Link>
        </div>
      )}
      <AgeStrip filters={filters} months={months} currentMonth={currentMonth} />
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
