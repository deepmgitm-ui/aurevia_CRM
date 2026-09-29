import { notFound } from "next/navigation";
import Link from "next/link";
import { Lock } from "lucide-react";

import { getAnalyticsLeads, getEmployeeDirectory, getViewer, type EmployeeDirectoryEntry } from "@/app/actions/leads";
import { buttonVariants } from "@/components/ui/button";

import { AgentSection } from "../overview/agent-section";
import { LeadOpenButton } from "../lead-open-button";
import { PipelineDetail } from "../overview/pipeline-detail";
import { CitiesChart, SourcesChart, TreatmentCoverageNote, TrendChart } from "../overview/charts";
import { DashboardGreeting } from "../overview/greeting";
import { KpiCards } from "../overview/kpi-cards";
import { SectionCard, SectionHeader, StatTable, type StatTableColumn, type StatTableRow } from "../overview/stat-table";
import {
  currentQuarterRange,
  formatNumber,
  formatRate,
  parseIsoDate,
  resolveDashboardMetrics,
  toAnalyticsLead,
  type AnalyticsLead,
  type BreakdownRow,
  type DashboardMetrics,
  type DateRange,
  type PipelineRow,
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

/** Same default window as the header button (current quarter, or ?from/?to). */
function resolveRange(params: { from?: string; to?: string }): DateRange {
  const quarter = currentQuarterRange();
  return {
    from: parseIsoDate(params.from) ? String(params.from) : quarter.from,
    to: parseIsoDate(params.to) ? String(params.to) : quarter.to,
  };
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

const PATIENT_COLUMNS: StatTableColumn[] = [
  { key: "name", label: "Patient" },
  { key: "city", label: "City" },
  { key: "treatment", label: "Treatment" },
  { key: "source", label: "Source" },
  { key: "agent", label: "Assigned To" },
  { key: "status", label: "Status" },
  { key: "date", label: "Lead Date" },
];

function patientTableRows(rows: AnalyticsLead[]): StatTableRow[] {
  return rows.slice(0, 50).map((row) => ({
    key: row.id,
    cells: {
      name: (
        <LeadOpenButton
          leadId={row.id}
          title={`${row.treatment || row.disease} · ${row.city}`}
          label={row.name || "—"}
          className="font-medium text-slate-900 hover:underline"
        />
      ),
      city: row.city,
      treatment: row.treatment || row.disease,
      source: row.source,
      agent: row.assigned_to,
      status: row.status,
      date: row.lead_date,
    },
  }));
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

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
          <SectionCard
            title="Patient pipeline"
            description="Latest 50 patients — naam pe tap karke poora record dekho aur wahi se edit karo."
          >
            <StatTable
              columns={PATIENT_COLUMNS}
              rows={patientTableRows(rows.filter((row) => row.status.trim().toLowerCase() !== "new"))}
              emptyMessage="No patients beyond the first contact in this window yet."
            />
          </SectionCard>
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

  const range = resolveRange(query);
  const [viewerResult, leadsResult, directoryResult] = await Promise.all([
    getViewer(),
    // Light projection (no `select('*')`) — only the columns the cards read.
    getAnalyticsLeads(),
    getEmployeeDirectory(),
  ]);

  const viewer = viewerResult.success ? viewerResult.data : null;
  const isTeamLead = viewer?.role === "admin" || viewer?.role === "manager";
  const rows = (leadsResult.success ? leadsResult.data : []).map(toAnalyticsLead);
  const employees = directoryResult.success ? directoryResult.data : [];
  const metrics = resolveDashboardMetrics(rows, range, employees);

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4">
      <DashboardGreeting name={viewer?.name} role={viewer?.role} />
      {renderSection(section, metrics, rows, employees, isTeamLead)}
    </div>
  );
}


