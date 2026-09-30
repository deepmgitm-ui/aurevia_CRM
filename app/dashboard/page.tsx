import Link from "next/link";
import { ArrowLeft, Flame, UserPlus, Users } from "lucide-react";

import {
  getAnalyticsLeads,
  getEmployeeDirectory,
  getLeadCounts,
  getLeadsPage,
  getPipelineInsights,
  getTeamStats,
  getViewer,
} from "@/app/actions/leads";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { LeadsTable } from "./leads-table";
import { SmartAssignmentBanner } from "./smart-assignment";
import { DashboardGreeting } from "./overview/greeting";
import { OverviewDashboard } from "./overview/overview-dashboard";
import { currentQuarterRange, defaultDashboardRange, formatRangeLabel, parseIsoDate, toAnalyticsLead, type DateRange } from "./overview/analytics";
import { PipelineInsights } from "./pipeline-insights";
import { TeamOverview } from "./team-overview";

const statCards = [
  {
    label: "Total Leads",
    icon: Users,
    iconClassName: "bg-slate-100 text-slate-600",
  },
  {
    label: "New Leads",
    icon: UserPlus,
    iconClassName: "bg-blue-50 text-blue-600",
  },
  {
    label: "Hot Leads",
    icon: Flame,
    iconClassName: "bg-orange-50 text-orange-600",
  },
] as const;

const emptyTeam = { employees: [], unassigned: 0, total: 0 };

function StatCardSection({ values }: { values: [number, number, number] }) {
  return (
    <section
      aria-label="Lead statistics"
      className="grid grid-cols-1 gap-4 md:grid-cols-3"
    >
      {statCards.map(({ label, icon: Icon, iconClassName }, index) => (
        <Card key={label} className="border-0 shadow-sm">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              {label}
            </CardTitle>
            <span
              className={`flex size-10 items-center justify-center rounded-lg ${iconClassName}`}
            >
              <Icon className="size-5" aria-hidden="true" />
            </span>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tracking-tight text-slate-950">
              {values[index].toLocaleString()}
            </p>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

/** Header range (?from/?to) with the current quarter as the default window. */
function resolveRange(params: { from?: string; to?: string }): DateRange {
  const quarter = currentQuarterRange();
  return {
    from: parseIsoDate(params.from) ? String(params.from) : quarter.from,
    to: parseIsoDate(params.to) ? String(params.to) : quarter.to,
  };
}

/** True when the URL pinned an explicit window (don't second-guess the user). */
function hasExplicitRange(params: { from?: string; to?: string }): boolean {
  return Boolean(parseIsoDate(params.from) || parseIsoDate(params.to));
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ employee?: string; from?: string; to?: string }>;
}) {
  const query = await searchParams;
  const { employee: selectedEmployee } = query;
  const viewerResult = await getViewer();
  const viewer = viewerResult.success ? viewerResult.data : null;
  const isTeamLead = viewer?.role === "admin" || viewer?.role === "manager";
  // ---- Admin/Manager drill-down: one employee's leads table ----
  if (isTeamLead && selectedEmployee) {
    const teamResult = await getTeamStats();
    const employeeStats = teamResult.success
      ? teamResult.data.employees.find((member) => member.name === selectedEmployee)
      : undefined;

    if (employeeStats) {
      // Server-side pagination scoped to this employee (assigned_to filter).
      const [leadsResult, countsResult] = await Promise.all([
        getLeadsPage(1, 50, "", selectedEmployee),
        getLeadCounts(selectedEmployee),
      ]);
      const leadsPage = leadsResult.success ? leadsResult.data : { leads: [], total: 0, totalPages: 1 };
      const counts = countsResult.success
        ? countsResult.data
        : { total: 0, new: 0, hot: 0, won: 0, lost: 0 };

      return (
        <div className="mx-auto w-full max-w-7xl space-y-6">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to Team Dashboard
          </Link>

          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
              {employeeStats.name}
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Leads assigned to this team member.
            </p>
          </div>

          <StatCardSection values={[counts.total, counts.new, counts.hot]} />

          <LeadsTable
            leads={leadsPage.leads}
            initialTotal={leadsPage.total}
            initialTotalPages={leadsPage.totalPages}
            assignedTo={employeeStats.name}
            role={viewer?.role ?? "employee"}
          />
        </div>
      );
    }
    // Unknown employee in the URL — fall through to the Team Overview.
  }

  // ---- Admin/Manager default view: the analytics Overview dashboard ----
  if (isTeamLead) {
    const [leadsResult, directoryResult, teamResult] = await Promise.all([
      // Light projection (no `select('*')`) — only the columns the cards read.
      getAnalyticsLeads(),
      getEmployeeDirectory(),
      getTeamStats(),
    ]);
    const leads = leadsResult.success ? leadsResult.data : [];
    const employees = directoryResult.success ? directoryResult.data : [];
    const team = teamResult.success ? teamResult.data : emptyTeam;
    const rows = leads.map(toAnalyticsLead);
    // The window must be able to SHOW the data: a quarter with no leads (an
    // import from an older month) would otherwise render every card as zero.
    const range = hasExplicitRange(query) ? resolveRange(query) : defaultDashboardRange(rows);
    const rangeNote =
      !hasExplicitRange(query) && formatRangeLabel(range) !== formatRangeLabel(currentQuarterRange())
        ? `Your leads fall between ${range.from} and ${range.to}, so the dashboard opened on that window instead of the current quarter. Pick any dates in the filter bar to change it.`
        : undefined;
    const insightsResult = await getPipelineInsights();
    const insights = insightsResult.success ? insightsResult.data : null;

    return (
      <div className="mx-auto w-full max-w-[1600px] space-y-6">
        {team.unassigned > 0 && (
          <SmartAssignmentBanner
            unassigned={team.unassigned}
            employees={team.employees.map(({ id, name }) => ({ id, name }))}
          />
        )}

        <OverviewDashboard
          rows={rows}
          employees={employees}
          range={range}
          rangeNote={rangeNote}
          viewer={viewer ? { name: viewer.name, role: viewer.role } : undefined}
        />

        {/* The old Team Dashboard survives as a roster grid: clicking a card
            still opens that member's leads (?employee=<name>). */}
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-950">Team roster</h2>
            <p className="text-sm text-slate-500">
              {team.total.toLocaleString()} leads in the pipeline across {team.employees.length} team member
              {team.employees.length === 1 ? "" : "s"}. Click a team member to view their leads.
            </p>
          </div>
          <TeamOverview team={team} />
        </section>

        {insights && <PipelineInsights insights={insights} />}
      </div>
    );
  }

  // ---- Employee default view: their own leads table, directly ----
  // Server-side scoping (RLS + assigned_to filter) limits the table to the
  // signed-in employee's own leads.
  const [leadsResult, countsResult, insightsResult] = await Promise.all([getLeadsPage(1), getLeadCounts(), getPipelineInsights()]);
  const leadsPage = leadsResult.success ? leadsResult.data : { leads: [], total: 0, totalPages: 1 };
  const counts = countsResult.success
    ? countsResult.data
    : { total: 0, new: 0, hot: 0, won: 0, lost: 0 };
  const values = [counts.total, counts.new, counts.hot];
  const insights = insightsResult.success ? insightsResult.data : null;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8">
      <DashboardGreeting name={viewer?.name} role={viewer?.role} />

      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
          Dashboard Overview
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Keep track of your pipeline and lead activity.
        </p>
      </div>

      <StatCardSection values={[values[0], values[1], values[2]]} />

      <LeadsTable leads={leadsPage.leads} initialTotal={leadsPage.total} initialTotalPages={leadsPage.totalPages} role={viewer?.role ?? "employee"} />
      {insights && <PipelineInsights insights={insights} />}
    </div>
  );
}
