import { notFound } from "next/navigation";
import Link from "next/link";
import { Info, Lock } from "lucide-react";

import { getAnalyticsLeads, getEmployeeDirectory, getViewer, type EmployeeDirectoryEntry } from "@/app/actions/leads";
import { buttonVariants } from "@/components/ui/button";

import { AgentSection } from "../overview/agent-section";
import { LeadListTable } from "../overview/lead-list-table";
import { PipelineDetail } from "../overview/pipeline-detail";
import { CitiesChart, SourcesChart, TreatmentCoverageNote, TrendChart } from "../overview/charts";
import { DashboardGreeting } from "../overview/greeting";
import { KpiCards } from "../overview/kpi-cards";
import { SectionCard, SectionHeader, StatTable, type StatTableColumn, type StatTableRow } from "../overview/stat-table";
import {
  filterLeadsByRange,
  formatNumber,
  formatRate,
  resolveDashboardMetrics,
  resolveDashboardWindow,
  stageForStatus,
  toAnalyticsLead,
  type AnalyticsLead,
  type BreakdownRow,
  type DashboardMetrics,
  type PipelineRow,
  type StageKey,
} from "../overview/analytics";

// Every secondary tab / sidebar module, all fed by the same aggregation.
const SECTIONS = [
  "lead-analysis",
  "consultations",
  "surgeries",
  "patients",
  "agents",
  "marketing",
  "reports",
  "source-analysis",
  "city-analysis",
] as const;

type SectionSlug = (typeof SECTIONS)[number];

function isSection(value: string): value is SectionSlug {
  return (SECTIONS as readonly string[]).includes(value);
}

/** The amber strip telling the user the window moved to fit the data. */
function RangeNote({ note }: { note?: string }) {
  if (!note) return null;
  return (
    <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {note}
    </p>
  );
}

const BREAKDOWN_COLUMNS: StatTableColumn[] = [
  { key: "label", label: "Segment" },
  { key: "leads", label: "Leads", align: "right" },
  { key: "consultations", label: "Consultations", align: "right" },
  { key: "surgeries", label: "Surgeries", align: "right" },
  { key: "conversion", label: "Conversion", align: "right" },
];

function breakdownTableRows(rows: BreakdownRow[]): StatTableRow[] {
  return rows.map((row) => ({
    key: row.label,
    cells: {
      label: <span className="font-medium text-slate-900">{row.label}</span>,
      leads: formatNumber(row.leads),
      consultations: formatNumber(row.consultations),
      surgeries: formatNumber(row.surgeries),
      conversion: formatRate(row.conversion),
    },
  }));
}

const STAGE_COLUMNS: StatTableColumn[] = [
  { key: "stage", label: "Pipeline stage" },
  { key: "series", label: "Treatments", align: "right" },
  { key: "total", label: "Total", align: "right" },
];

function stageTableRows(pipeline: PipelineRow[]): StatTableRow[] {
  return pipeline.map((row) => {
    const seriesText = row.series
      .map((entry) => `${entry.label}: ${formatNumber(entry.value)}`)
      .join("  ·  ");
    return {
      key: row.key,
      cells: {
        stage: <span className="font-medium text-slate-900">{row.stage}</span>,
        series: <span className="text-slate-600">{seriesText || "—"}</span>,
        total: <span className="font-semibold text-slate-900">{formatNumber(row.total)}</span>,
      },
    };
  });
}

const TREATMENT_COLUMNS: StatTableColumn[] = [
  { key: "treatment", label: "Treatment type" },
  { key: "new", label: "New Lead", align: "right" },
  { key: "contacted", label: "Contacted", align: "right" },
  { key: "booked", label: "Consultation Booked", align: "right" },
  { key: "attended", label: "Consultation Attended", align: "right" },
  { key: "surgery", label: "Surgery Completed", align: "right" },
  { key: "total", label: "Total", align: "right" },
];

function treatmentTableRows(pipeline: PipelineRow[]): StatTableRow[] {
  const treatmentKeys = new Map<string, string>();
  for (const row of pipeline) {
    for (const entry of row.series) {
      if (!treatmentKeys.has(entry.key)) treatmentKeys.set(entry.key, entry.label);
    }
  }
  const valueFor = (treatmentKey: string, stageKey: string) =>
    pipeline.find((row) => row.key === stageKey)?.series.find((entry) => entry.key === treatmentKey)?.value ?? 0;
  const stageKeys = ["new", "contacted", "booked", "attended", "surgery"];
  return [...treatmentKeys.entries()].map(([treatmentKey, label]) => {
    const total = stageKeys.reduce((sum, stageKey) => sum + valueFor(treatmentKey, stageKey), 0);
    return {
      key: treatmentKey,
      cells: {
        treatment: <span className="font-medium text-slate-900">{label}</span>,
        new: formatNumber(valueFor(treatmentKey, "new")),
        contacted: formatNumber(valueFor(treatmentKey, "contacted")),
        booked: formatNumber(valueFor(treatmentKey, "booked")),
        attended: formatNumber(valueFor(treatmentKey, "attended")),
        surgery: formatNumber(valueFor(treatmentKey, "surgery")),
        total: <span className="font-semibold text-slate-900">{formatNumber(total)}</span>,
      },
    };
  });
}

const AGENT_COLUMNS: StatTableColumn[] = [
  { key: "name", label: "Agent" },
  { key: "leads", label: "Leads", align: "right" },
  { key: "hot", label: "Hot", align: "right" },
  { key: "consultations", label: "Consultations", align: "right" },
  { key: "surgeries", label: "Surgeries", align: "right" },
  { key: "conversion", label: "Conversion", align: "right" },
];

function agentTableRows(metrics: DashboardMetrics): StatTableRow[] {
  return metrics.agents.map((agent) => ({
    key: agent.id,
    cells: {
      name: (
        <Link
          href={`/dashboard?employee=${encodeURIComponent(agent.name)}`}
          className="font-medium text-slate-900 hover:underline"
        >
          {agent.name}
        </Link>
      ),
      leads: formatNumber(agent.leads),
      hot: formatNumber(agent.hot),
      consultations: formatNumber(agent.consultations),
      surgeries: formatNumber(agent.surgeries),
      conversion: formatRate(agent.conversion),
    },
  }));
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/**
 * The leads sitting in any of the given pipeline stages. The tabs answer "how
 * many"; this is the "which patients" behind that number, so every section
 * ends with the same kind of list the Overview dashboard shows.
 */
function leadsInStages(rows: AnalyticsLead[], stages: StageKey[]): AnalyticsLead[] {
  const wanted = new Set(stages);
  return rows.filter((row) => wanted.has(stageForStatus(row.status)));
}

// A consultation is booked OR attended; a surgery is the completed stage only,
// so the list always matches the "Surgeries Completed" KPI above it.
const CONSULTATION_STAGES: StageKey[] = ["booked", "attended"];
const SURGERY_STAGES: StageKey[] = ["surgery"];

function LeadListCard({
  title,
  description,
  rows,
  limit = 50,
  emptyMessage,
}: {
  title: string;
  description: string;
  rows: AnalyticsLead[];
  limit?: number;
  emptyMessage: string;
}) {
  if (rows.length === 0) return null;
  const capped = rows.length > limit;
  return (
    <SectionCard
      title={`${title} (${rows.length})`}
      description={
        capped
          ? `${description} — showing the first ${limit}; the rest are in the Leads module.`
          : `${description} — click a name to open the full record.`
      }
    >
      <LeadListTable rows={rows} limit={limit} emptyMessage={emptyMessage} />
    </SectionCard>
  );
}

function AdminOnlyNotice() {
  return (
    <section className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
        <Lock className="size-5" aria-hidden="true" />
      </span>
      <h1 className="text-lg font-semibold text-slate-900">Agent directory is restricted</h1>
      <p className="max-w-md text-sm text-slate-500">
        Performance and HR details are visible to admins and managers only. Your own leads stay available in the
        Leads module.
      </p>
      <Link
        href="/dashboard/leads"
        className={buttonVariants({ variant: "outline", size: "sm", className: "rounded-lg" })}
      >
        Go to my leads
      </Link>
    </section>
  );
}

function renderSection(
  section: SectionSlug,
  metrics: DashboardMetrics,
  rows: AnalyticsLead[],
  employees: EmployeeDirectoryEntry[],
  isTeamLead: boolean,
) {
  switch (section) {
    case "lead-analysis":
      return (
        <>
          <SectionHeader
            title="Lead Analysis"
            description="Funnel health: how many leads move from first contact to a completed surgery in the selected window."
          />
          <KpiCards kpis={metrics.kpis} />
          <SectionCard title="Leads Pipeline by Stage" description="Treatment-wise split for every stage. Tap a segment to see those patients and edit them inline.">
            <PipelineDetail data={metrics.pipeline} />
            <TreatmentCoverageNote coverage={metrics.treatmentCoverage} />
          </SectionCard>
          <SectionCard title="Stage totals">
            <StatTable columns={STAGE_COLUMNS} rows={stageTableRows(metrics.pipeline)} />
          </SectionCard>
        </>
      );

    case "consultations":
      return (
        <>
          <SectionHeader
            title="Consultations"
            description="Every lead that reached a booked / attended consultation, month by month."
          />
          <KpiCards kpis={metrics.kpis} />
          <SectionCard title="Consultations &amp; Surgeries Trend" description="Booked consultations against completed surgeries.">
            <TrendChart data={metrics.trend} />
          </SectionCard>
          <SectionCard title="Consultations by agent">
            <StatTable columns={AGENT_COLUMNS} rows={agentTableRows(metrics)} />
          </SectionCard>
          <LeadListCard
            title="Consultation patients"
            description="Patients with a booked or attended consultation."
            rows={leadsInStages(rows, CONSULTATION_STAGES)}
            emptyMessage="No booked or attended consultations in this date range."
          />
        </>
      );

    case "surgeries":
      return (
        <>
          <SectionHeader
            title="Surgeries"
            description={`${formatNumber(metrics.totals.surgeries)} completed surgeries across ${formatNumber(
              metrics.cities.length,
            )} cities in this window.`}
          />
          <KpiCards kpis={metrics.kpis} />
          <SectionCard title="Top Cities by Surgeries">
            <CitiesChart rows={metrics.cities} />
          </SectionCard>
          <SectionCard title="Surgeries by treatment type">
            <StatTable columns={TREATMENT_COLUMNS} rows={treatmentTableRows(metrics.pipeline)} />
          </SectionCard>
          <LeadListCard
            title="Surgery records"
            description="Patients with a completed surgery."
            rows={leadsInStages(rows, SURGERY_STAGES)}
            emptyMessage="No completed surgeries in this date range."
          />
        </>
      );

    case "patients":
      return (
        <>
          <SectionHeader
            title="Patients"
            description="Leads that moved past the first contact — the patients your team is actively working on."
          />
          <KpiCards kpis={metrics.kpis} />
          <LeadListCard
            title="Patients"
            description="Leads that have moved past first contact — the team currently working these"
            rows={rows.filter((row) => row.status.trim().toLowerCase() !== "new")}
            emptyMessage="No leads in this date range have moved past first contact."
          />
        </>
      );

    case "agents":
      if (!isTeamLead) return <AdminOnlyNotice />;
      return (
        <>
          <SectionHeader
            title="Agents Performance"
            description="Names only on the roster — open a card for the secure performance and HR panel."
          />
          <AgentSection employees={employees} agents={metrics.agents} />
          <LeadListCard
            title="Team leads"
            description="Every agent's assigned leads — use the Assigned To column to see who owns which"
            rows={rows}
            limit={100}
            emptyMessage="No leads in this date range."
          />
        </>
      );

    case "marketing":
      return (
        <>
          <SectionHeader
            title="Marketing"
            description="Which channels bring the leads in, and how each channel performs."
          />
          <KpiCards kpis={metrics.kpis} />
          <SectionCard title="Lead Source Performance">
            <SourcesChart rows={metrics.sources} />
          </SectionCard>
          <SectionCard title="Source-wise performance" description="Conversion and surgery counts by acquisition channel.">
            <StatTable columns={BREAKDOWN_COLUMNS} rows={breakdownTableRows(metrics.sources)} />
          </SectionCard>
          <LeadListCard
            title="Leads by source"
            description="Leads from every channel — group them by the Source column"
            rows={rows}
            limit={100}
            emptyMessage="No leads in this date range."
          />
        </>
      );

    case "reports":
      return (
        <>
          <SectionHeader
            title="Reports"
            description="One-page consolidation of every metric for the selected window. Leads can be exported as CSV from the Leads module."
          />
          <KpiCards kpis={metrics.kpis} />
          <SectionCard title="City performance">
            <StatTable columns={BREAKDOWN_COLUMNS} rows={breakdownTableRows(metrics.cities)} />
          </SectionCard>
          <SectionCard title="Source performance">
            <StatTable columns={BREAKDOWN_COLUMNS} rows={breakdownTableRows(metrics.sources)} />
          </SectionCard>
          <SectionCard title="Agent performance">
            <StatTable columns={AGENT_COLUMNS} rows={agentTableRows(metrics)} />
          </SectionCard>
          <LeadListCard
            title="All leads in this window"
            description="Every lead in this range, same as the Overview dashboard — click a name to open the record"
            rows={rows}
            limit={100}
            emptyMessage="No leads in this date range."
          />
        </>
      );

    case "source-analysis":
      return (
        <>
          <SectionHeader
            title="Source Analysis"
            description="Where the leads come from, how they convert, and what each channel is worth."
          />
          <SectionCard title="Lead Source Performance">
            <SourcesChart rows={metrics.sources} />
          </SectionCard>
          <SectionCard title="Source breakdown">
            <StatTable columns={BREAKDOWN_COLUMNS} rows={breakdownTableRows(metrics.sources)} />
          </SectionCard>
          <LeadListCard
            title="Leads by source"
            description="Leads from every channel — group them by the Source column"
            rows={rows}
            limit={100}
            emptyMessage="No leads in this date range."
          />
        </>
      );

    case "city-analysis":
      return (
        <>
          <SectionHeader title="City Analysis" description="Where the demand is coming from, city by city." />
          <SectionCard title="Top Cities by Surgeries">
            <CitiesChart rows={metrics.cities} />
          </SectionCard>
          <SectionCard title="City breakdown">
            <StatTable columns={BREAKDOWN_COLUMNS} rows={breakdownTableRows(metrics.cities)} />
          </SectionCard>
          <LeadListCard
            title="Leads by city"
            description="All leads — group them by the City column"
            rows={rows}
            limit={100}
            emptyMessage="No leads in this date range."
          />
        </>
      );

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function SectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const [{ section }, query] = await Promise.all([params, searchParams]);
  if (!isSection(section)) notFound();

  const [viewerResult, leadsResult, directoryResult] = await Promise.all([
    getViewer(),
    // Light projection (no `select('*')`) — only the columns the cards read.
    getAnalyticsLeads(),
    getEmployeeDirectory(),
  ]);

  const viewer = viewerResult.success ? viewerResult.data : null;
  const isTeamLead = viewer?.role === "admin" || viewer?.role === "manager";
  const allRows = (leadsResult.success ? leadsResult.data : []).map(toAnalyticsLead);
  const employees = directoryResult.success ? directoryResult.data : [];
  // Same window the Overview dashboard opens on, so a tab can never disagree
  // with the home page (that drift is what made every lead table read 0).
  const { range, note: rangeNote } = resolveDashboardWindow(query, allRows);
  const metrics = resolveDashboardMetrics(allRows, range, employees);
  // Every lead list below must honour the window the screen opened on. Without
  // this a table would show patients the KPIs above it are not counting.
  const rows = filterLeadsByRange(allRows, range);

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4">
      <DashboardGreeting name={viewer?.name} role={viewer?.role} />
      <RangeNote note={rangeNote} />
      {renderSection(section, metrics, rows, employees, isTeamLead)}
    </div>
  );
}

