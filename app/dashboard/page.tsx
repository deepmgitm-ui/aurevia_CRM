import Link from "next/link";
import { ArrowLeft, Flame, UserPlus, Users, CalendarCheck, BedDouble, ArrowRight, CircleCheck } from "lucide-react";

import {
  getAnalyticsLeads,
  getEmployeeDirectory,
  getLeadCounts,
  getLeadsPage,
  getPipelineInsights,
  getTeamStats,
  getViewer,
  getDailyWorkCounts,
  getDailyAssignmentStatuses,
  getLeadPipelineSummary,
} from "@/app/actions/leads";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { TeamActivityPanel } from "./team-activity-panel";
import { LeadsTable } from "./leads-table";
import { DashboardGreeting } from "./overview/greeting";
import { OverviewDashboard } from "./overview/overview-dashboard";
import { resolveDashboardWindow, toAnalyticsLead } from "./overview/analytics";
import { PipelineInsights } from "./pipeline-insights";
import { LeadAssignmentTabs } from "./lead-assignment-tabs";
import { clinicDate } from "@/lib/attendance";
import { isDailyWorkKind, isWorkDate, type DailyWorkKind } from "@/lib/daily-work";
import { EMPTY_LEAD_FILTERS, leadsHref } from "./lead-filters";

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

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ employee?: string; from?: string; to?: string; work?: string; day?: string; status?: string }>;
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
      getAnalyticsLeads(query.from, query.to),
      getEmployeeDirectory(),
      getTeamStats(),
    ]);
    if(!leadsResult.success) throw new Error(leadsResult.error);
    const leads = leadsResult.data;
    const employees = directoryResult.success ? directoryResult.data : [];
    const team = teamResult.success ? teamResult.data : emptyTeam;
    const rows = leads.map(toAnalyticsLead);
    // The window must be able to SHOW the data: a quarter with no leads (an
    // import from an older month) would otherwise render every card as zero.
    // Shared with every analysis tab so the two can never disagree.
    const { range, note: rangeNote } = resolveDashboardWindow(query, rows);
    const insightsResult = await getPipelineInsights();
    const insights = insightsResult.success ? insightsResult.data : null;

    return (
      <div className="mx-auto w-full max-w-[1600px] space-y-6">
        <OverviewDashboard
          rows={rows}
          employees={employees}
          range={range}
          rangeNote={rangeNote}
          viewer={viewer ? { name: viewer.name, role: viewer.role } : undefined}
        />

        {teamResult.success ? <LeadAssignmentTabs team={team} /> : <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Agent totals could not be loaded. Please refresh.</p>}

        {insights && <PipelineInsights insights={insights} />}
        <TeamActivityPanel day={clinicDate()} />
      </div>
    );
  }

  // ---- Employee default view: their own leads table, directly ----
  // Server-side scoping (RLS + assigned_to filter) limits the table to the
  // signed-in employee's own leads.
  const today = clinicDate();
  const day = isWorkDate(query.day ?? "") ? query.day! : today;
  const work: DailyWorkKind = isDailyWorkKind(query.work ?? "") ? query.work as DailyWorkKind : "assigned";
  const selectedStatus = work === "assigned" ? (query.status ?? "").trim() : "";
  const filters = { ...EMPTY_LEAD_FILTERS, work, day, status: selectedStatus };
  const [leadsResult, dailyResult, statusResult, summaryResult] = await Promise.all([
    getLeadsPage(1, 50, "", "", "", filters),
    getDailyWorkCounts(day),
    getDailyAssignmentStatuses(day),
    getLeadPipelineSummary(),
  ]);
  const leadsPage = leadsResult.success ? leadsResult.data : { leads: [], total: 0, totalPages: 1 };
  const dayLabel = new Date(`${day}T12:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const isToday = day === today;
  const dailyCards: {key:DailyWorkKind;label:string;detail:string;icon:typeof UserPlus;tone:string}[] = [
    { key: "opd" as const, label: "OPD appointments", detail: "Patients with an OPD date on this day", icon: CalendarCheck, tone: "border-emerald-200 bg-emerald-50 text-emerald-800" },
    { key: "opdDone" as const, label: "OPD Done", detail: "Patients whose recorded OPD completion date is this day", icon: CircleCheck, tone: "border-teal-200 bg-teal-50 text-teal-800" },
    { key: "ipd" as const, label: "IPD appointments", detail: "Patients with a recorded IPD / surgery date on this day", icon: BedDouble, tone: "border-violet-200 bg-violet-50 text-violet-800" },
  ];
  dailyCards.push({ key: "ipdDone", label: "IPD Done", detail: "Patients whose IPD appointment was completed on this day", icon: CircleCheck, tone: "border-purple-200 bg-purple-50 text-purple-800" });
  const selectedCard = dailyCards.find((card) => card.key === work) ?? {
    key: "assigned" as const,
    label: "New Leads",
    detail: "New calling assignments received on this date",
    icon: UserPlus,
    tone: "border-blue-200 bg-blue-50 text-blue-800",
  };

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8">
      <DashboardGreeting name={viewer?.name} role={viewer?.role} />
      <TeamActivityPanel key={day} day={day} own />

      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
          {isToday ? "My day" : "My daily work"}
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          {dayLabel} · New calling assignments and patient appointments, all in one place.
        </p>
        <form key={day} action="/dashboard" className="mt-4 flex flex-wrap items-end gap-2">
          <input type="hidden" name="work" value={work} />
          {selectedStatus && <input type="hidden" name="status" value={selectedStatus} />}
          <label className="text-xs font-medium text-slate-600">Work date
            <input type="date" name="day" defaultValue={day} required className="mt-1 block rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900" />
          </label>
          <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">View day</button>
        </form>
      </div>

      <section aria-label="My lead pipeline" className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">My lead pipeline</h2>
          <p className="mt-1 text-sm text-slate-500">Tap a count to open the matching leads in your table.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
          {([
            { label: "New Leads", value: dailyResult.success ? dailyResult.data.assigned : null, bucket: "", tone: "border-indigo-200 bg-indigo-50 text-indigo-800" },
            { label: "Fresh leads", value: summaryResult.success ? summaryResult.data.fresh : null, bucket: "fresh", tone: "border-blue-200 bg-blue-50 text-blue-800" },
            { label: "Follow-up", value: summaryResult.success ? summaryResult.data.followUp : null, bucket: "followup", tone: "border-sky-200 bg-sky-50 text-sky-800" },
            { label: "OPD booked", value: summaryResult.success ? summaryResult.data.opdBooked : null, bucket: "opdBooked", tone: "border-amber-200 bg-amber-50 text-amber-800" },
            { label: "OPD done", value: summaryResult.success ? summaryResult.data.opdDone : null, bucket: "opdDone", tone: "border-emerald-200 bg-emerald-50 text-emerald-800" },
            { label: "IPD booked", value: summaryResult.success ? summaryResult.data.ipdBooked : null, bucket: "ipdBooked", tone: "border-violet-200 bg-violet-50 text-violet-800" },
            { label: "IPD done", value: summaryResult.success ? summaryResult.data.ipdDone : null, bucket: "ipdDone", tone: "border-purple-200 bg-purple-50 text-purple-800" },
          ] as const).map((card) => (
            <Link key={card.label} href={card.label === "New Leads" ? `/dashboard?work=assigned&day=${day}#today-leads` : `${leadsHref({ bucket: card.bucket, allMonths: true })}#lead-list`} aria-current={card.label === "New Leads" && work === "assigned" ? "page" : undefined} className={`rounded-xl border px-4 py-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${card.tone} ${card.label === "New Leads" && work === "assigned" ? "ring-2 ring-current ring-offset-2" : ""}`}>
              <p className="text-xs font-semibold">{card.label}</p>
              <p className="mt-2 text-3xl font-semibold tabular-nums">{card.value === null ? "—" : card.value.toLocaleString()}</p>
              <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium">View leads <ArrowRight className="size-3" aria-hidden="true" /></span>
            </Link>
          ))}
        </div>
        {!summaryResult.success && <p role="alert" className="text-sm text-amber-700">Lead summary could not be loaded. Refresh to try again.</p>}
      </section>

      <section aria-label="Daily appointments and completions" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {dailyCards.map(({ key, label, detail, icon: Icon, tone }) => (
          <Link key={key} href={`/dashboard?work=${key}&day=${day}#today-leads`} aria-current={work === key ? "page" : undefined}
            className={`rounded-2xl border p-5 shadow-sm transition hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${tone} ${work === key ? "ring-2 ring-current ring-offset-2" : ""}`}>
            <div className="flex items-center justify-between"><span className="text-sm font-semibold">{isToday ? "Today’s " : ""}{label}</span><Icon className="size-5" aria-hidden="true" /></div>
            <p className="mt-4 text-4xl font-semibold tabular-nums">{dailyResult.success ? dailyResult.data[key].toLocaleString() : "—"}</p>
            <p className="mt-2 text-xs opacity-80">{detail}</p>
            <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold">View leads <ArrowRight className="size-3" aria-hidden="true" /></span>
          </Link>
        ))}
      </section>
      <section aria-label="Assignment status breakdown" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-950">{isToday ? "Today’s assigned leads" : "Assigned leads for this date"} · Status breakdown</h2>
          <Link href={`/dashboard?work=assigned&day=${day}#today-leads`} className="text-sm font-semibold text-blue-700 hover:underline">View all assignments</Link>
        </div>
        <p className="mt-1 text-sm text-slate-500">Current status of leads received on {dayLabel}. OPD and IPD cards above include your earlier assignments too.</p>
        {statusResult.success ? statusResult.data.length === 0 ? (
          <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No new leads were assigned to you on this date.</p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {statusResult.data.map(({ status, count }) => {
              const content = <><span className="text-sm font-medium">{status?.trim() && status !== "-" ? status : "No status recorded"}</span><span className="text-2xl font-semibold tabular-nums">{count.toLocaleString()}</span></>;
              const className = `flex items-center justify-between gap-3 rounded-xl border px-4 py-3 ${selectedStatus && selectedStatus === status ? "border-blue-400 bg-blue-50 text-blue-800" : "border-slate-200 text-slate-700"}`;
              return status?.trim() ? <Link key={status} href={`/dashboard?work=assigned&day=${day}&status=${encodeURIComponent(status)}#today-leads`} aria-current={selectedStatus === status ? "page" : undefined} className={`${className} transition hover:border-blue-300 hover:bg-blue-50`}>{content}</Link> : <div key={status ?? "null"} className={className}>{content}</div>;
            })}
          </div>
        ) : <p role="alert" className="mt-4 text-sm text-amber-700">Assignment statuses could not be loaded. Please refresh.</p>}
      </section>
      {(!dailyResult.success || !leadsResult.success) && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Daily work could not be loaded. Please refresh or contact your administrator.</p>}
      <section id="today-leads" className="scroll-mt-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-xl font-semibold text-slate-950">{selectedCard.label}{selectedStatus ? ` · ${selectedStatus}` : ""}</h2><p className="mt-1 text-sm text-slate-500">{dayLabel} · {leadsPage.total.toLocaleString()} leads</p></div>
          <div className="flex gap-3 text-sm font-medium">
            {!isToday && <Link href="/dashboard" className="text-blue-700 hover:underline">Back to today</Link>}
            <Link href="/dashboard/leads?month=all" className="text-blue-700 hover:underline">All my leads</Link>
          </div>
        </div>
        {work === "assigned" && <p className="text-xs text-slate-500">Assignments are tracked from the daily-work update onwards. Older assignments without a recorded date remain in All my leads.</p>}
        {leadsResult.success && leadsPage.total === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center">
            <p className="font-semibold text-slate-800">No {selectedCard.label.toLowerCase()} for this date</p>
            <p className="mt-2 text-sm text-slate-500">Choose another date or open All my leads to continue working on your pipeline.</p>
          </div>
        ) : (
          <LeadsTable key={`${work}-${day}-${selectedStatus}`} leads={leadsPage.leads} initialTotal={leadsPage.total} initialTotalPages={leadsPage.totalPages} filters={filters} role={viewer?.role ?? "employee"} />
        )}
      </section>
    </div>
  );
}
