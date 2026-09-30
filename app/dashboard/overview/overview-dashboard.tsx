"use client";

// ---------------------------------------------------------------------------
// Admin Overview — filter row, six KPI scorecards and four Recharts cards.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import Link from "next/link";
import { BarChart3, Info, MapPin, Megaphone, PieChart } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { EmployeeDirectoryEntry } from "@/app/actions/leads";

import {
  ALL_FILTER_VALUE,
  applyFilters,
  buildDashboardMetrics,
  collectFilterOptions,
  createSampleMetrics,
  effectiveRange,
  emptyFilters,
  resolveDashboardMetrics,
  type AnalyticsLead,
  type DashboardFilters,
  type DateRange,
  type FilterOptions,
  type TrendPoint,
} from "./analytics";
import {
  CitiesChart,
  LegendDots,
  SourcesChart,
  TREND_COLORS,
  TreatmentCoverageNote,
  TrendChart,
} from "./charts";
import { FilterBar } from "./filter-bar";
import { DashboardGreeting } from "./greeting";
import { KpiCards } from "./kpi-cards";
import { PipelineDetail } from "./pipeline-detail";

type Granularity = "monthly" | "quarterly" | "yearly";

/** Rolls monthly trend points up into quarters / years for the Monthly dropdown. */
function bucketTrend(points: TrendPoint[], granularity: Granularity): TrendPoint[] {
  if (granularity === "monthly") return points;
  const size = granularity === "quarterly" ? 3 : 12;
  const buckets = new Map<string, TrendPoint>();
  for (const point of points) {
    const year = point.key.slice(0, 4);
    const month = Number(point.key.slice(5, 7));
    const quarter = Math.floor((month - 1) / size) + 1;
    const key = granularity === "quarterly" ? `${year}-Q${quarter}` : year;
    const label = granularity === "quarterly" ? `Q${quarter} ${year}` : year;
    const bucket =
      buckets.get(key) ??
      { key, month: label, leads: 0, consultations: 0, surgeries: 0, lost: 0 };
    bucket.leads += point.leads;
    bucket.consultations += point.consultations;
    bucket.surgeries += point.surgeries;
    bucket.lost += point.lost;
    buckets.set(key, bucket);
  }
  return [...buckets.values()];
}

function ChartCard({
  title,
  icon: Icon,
  action,
  legend,
  children,
}: {
  title: string;
  icon: typeof BarChart3;
  action?: React.ReactNode;
  legend?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <Icon className="size-4 text-blue-600" aria-hidden="true" />
          {title}
        </h2>
        {action}
      </header>
      {legend && <div className="mt-4">{legend}</div>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

export function OverviewDashboard({
  rows,
  employees,
  range,
  rangeNote,
  viewer,
}: {
  rows: AnalyticsLead[];
  employees: EmployeeDirectoryEntry[];
  range: DateRange;
  /** Set when the opening window was widened to match the data (never silent). */
  rangeNote?: string;
  /** Signed-in admin/manager — powers the personalised greeting banner. */
  viewer?: { name: string; role: string };
}) {
  const [filters, setFilters] = useState<DashboardFilters>(() => emptyFilters(range));
  const [granularity, setGranularity] = useState<Granularity>("monthly");
  const [pipelineTreatment, setPipelineTreatment] = useState<string>(ALL_FILTER_VALUE);

  // The header date-range button is the default window for the Lead Date filter.
  // Applied during render (React's documented "adjust state when props change"
  // pattern) rather than in an effect, so the header range never triggers the
  // cascading re-render an effect would.
  const [syncedRange, setSyncedRange] = useState<DateRange>(range);
  if (syncedRange.from !== range.from || syncedRange.to !== range.to) {
    setSyncedRange(range);
    setFilters((current) => ({ ...current, from: range.from, to: range.to }));
  }

  const isSample = rows.length === 0;
  const sampleMetrics = useMemo(() => createSampleMetrics(range), [range]);
  const filteredRows = useMemo(() => applyFilters(rows, filters), [rows, filters]);

  const metrics = useMemo(
    () =>
      isSample
        ? resolveDashboardMetrics(rows, range, employees)
        : buildDashboardMetrics(filteredRows, employees, effectiveRange(range, filters)),
    [isSample, rows, employees, range, filteredRows, filters],
  );

  const options: FilterOptions = useMemo(() => {
    if (!isSample) return collectFilterOptions(rows);
    return {
      cities: sampleMetrics.cities.map((city) => city.label),
      sources: sampleMetrics.sources.map((source) => source.label),
      treatments: sampleMetrics.treatmentSeries.map((entry) => entry.label),
      agents: sampleMetrics.agents.map((agent) => agent.name),
    };
  }, [isSample, rows, sampleMetrics]);

  const trendData = useMemo(() => bucketTrend(metrics.trend, granularity), [metrics.trend, granularity]);

  const trendLegend = useMemo(
    () => [
      { label: "Total Leads", color: TREND_COLORS.leads },
      { label: "Consultations Booked", color: TREND_COLORS.consultations },
      { label: "Surgeries Completed", color: TREND_COLORS.surgeries },
    ],
    [],
  );

  // The treatment dropdown mirrors whatever treatments actually exist in the
  // data (case-insensitive groups), so LASIK/Cataract/ICL are never stuck at 0.
  const pickedSeries = useMemo(() => {
    if (pipelineTreatment === ALL_FILTER_VALUE) return metrics.treatmentSeries;
    const match = metrics.treatmentSeries.filter((entry) => entry.key === pipelineTreatment);
    return match.length > 0 ? match : metrics.treatmentSeries;
  }, [metrics.treatmentSeries, pipelineTreatment]);

  const showAllTreatments = pickedSeries.length === metrics.treatmentSeries.length;

  const pipelineData = useMemo(() => {
    if (showAllTreatments) return metrics.pipeline;
    const keys = new Set(pickedSeries.map((entry) => entry.key));
    return metrics.pipeline.map((row) => {
      const cells = row.series.filter((cell) => keys.has(cell.key));
      return {
        key: row.key,
        stage: row.stage,
        series: cells,
        total: cells.reduce((sum, cell) => sum + cell.value, 0),
      };
    });
  }, [metrics.pipeline, pickedSeries, showAllTreatments]);

  const activeLegend = useMemo(
    () => pickedSeries.map((entry) => ({ label: entry.label, color: entry.color })),
    [pickedSeries],
  );

  const updateFilter = (key: keyof DashboardFilters, value: string) =>
    setFilters((current) => ({ ...current, [key]: value }));
  const resetFilters = () => setFilters(emptyFilters(range));

  return (
    <div className="space-y-4">
      <h1 className="sr-only">Admin overview dashboard</h1>

      <DashboardGreeting name={viewer?.name} role={viewer?.role} />

      <FilterBar filters={filters} options={options} isSample={isSample} onChange={updateFilter} onReset={resetFilters} />

      {rangeNote && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {rangeNote}
        </p>
      )}

      <KpiCards kpis={metrics.kpis} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard
          title="Leads & Surgeries Trend"
          icon={BarChart3}
          legend={<LegendDots items={trendLegend} />}
          action={
            <Select
              value={granularity}
              onValueChange={(value) => setGranularity(value === "quarterly" || value === "yearly" ? value : "monthly")}
            >
              <SelectTrigger className="h-9 w-32 rounded-lg border-slate-200" aria-label="Trend granularity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="quarterly">Quarterly</SelectItem>
                <SelectItem value="yearly">Yearly</SelectItem>
              </SelectContent>
            </Select>
          }
        >
          <TrendChart data={trendData} />
        </ChartCard>

        <ChartCard
          title="Leads Pipeline by Stage"
          icon={PieChart}
          legend={<LegendDots items={activeLegend} />}
          action={
            <Select
              value={pipelineTreatment}
              onValueChange={(value) => setPipelineTreatment(typeof value === "string" ? value : ALL_FILTER_VALUE)}
            >
              <SelectTrigger className="h-9 w-48 rounded-lg border-slate-200" aria-label="Filter pipeline by treatment type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_FILTER_VALUE}>Treatment Type: All</SelectItem>
                {metrics.treatmentSeries.map((entry) => (
                  <SelectItem key={entry.key} value={entry.key}>
                    Treatment Type: {entry.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        >
          <PipelineDetail data={pipelineData} series={pickedSeries} />
          <TreatmentCoverageNote coverage={metrics.treatmentCoverage} />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard
          title="Top Cities by Surgeries"
          icon={MapPin}
          action={
            <Link
              href="/dashboard/city-analysis"
              className={buttonVariants({ variant: "outline", size: "sm", className: "rounded-lg" })}
            >
              View All
            </Link>
          }
        >
          <CitiesChart rows={metrics.cities} />
        </ChartCard>

        <ChartCard
          title="Lead Source Performance"
          icon={Megaphone}
          action={
            <Link
              href="/dashboard/source-analysis"
              className={buttonVariants({ variant: "outline", size: "sm", className: "rounded-lg" })}
            >
              View All
            </Link>
          }
        >
          <SourcesChart rows={metrics.sources} />
        </ChartCard>
      </div>
    </div>
  );
}

