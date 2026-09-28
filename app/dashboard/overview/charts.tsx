"use client";

// ---------------------------------------------------------------------------
// Recharts building blocks for the admin overview dashboard.
// Colours mirror the design reference (dark navy → light blue → purple → pink).
// Heavy flattening/grouping is memoized so thousands of leads stay fast.
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import { useRouter } from "next/navigation";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { leadsHref } from "../lead-filters";
import {
  formatNumber,
  TREATMENT_COLORS,
  type BreakdownRow,
  type PipelineRow,
  type TreatmentSeries,
  type TrendPoint,
} from "./analytics";

export const TREND_COLORS = {
  leads: "#1e3a8a",
  consultations: "#7db6f5",
  surgeries: "#34d399",
} as const;

const CITY_COLORS = ["#1e3a8a", "#2563eb", "#93b4f7", "#10b981", "#86efac", "#c4b5fd", "#ddd6fe", "#f9a8d4"];
const SOURCE_COLORS = ["#1e3a8a", "#2563eb", "#93b4f7", "#10b981", "#86efac", "#c4b5fd", "#ddd6fe", "#f9a8d4"];

const AXIS_TICK = { fill: "#94a3b8", fontSize: 12 } as const;

const TOOLTIP_STYLE = {
  borderRadius: 12,
  border: "1px solid #e2e8f0",
  boxShadow: "0 10px 30px rgba(15, 23, 42, 0.08)",
  fontSize: 12,
  padding: "8px 12px",
} as const;

/** Tiny ascending bar glyph shown on every KPI card. */
export function MiniBars({ color, className = "" }: { color: string; className?: string }) {
  const heights = [8, 12, 16, 22];
  return (
    <span className={`inline-flex items-end gap-[3px] ${className}`} aria-hidden="true">
      {heights.map((height) => (
        <span
          key={height}
          className="w-[4px] rounded-sm"
          style={{ height, backgroundColor: color, opacity: height === 22 ? 0.95 : 0.55 }}
        />
      ))}
    </span>
  );
}

export function LegendDots({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {items.map(({ label, color }) => (
        <li key={label} className="flex items-center gap-2 text-xs font-medium text-slate-600">
          <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
          {label}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Leads & Surgeries Trend (multi-line + gradient area)
// ---------------------------------------------------------------------------

export function TrendChart({ data }: { data: TrendPoint[] }) {
  const maxValue = Math.max(...data.flatMap((point) => [point.leads, point.consultations, point.surgeries]), 10);
  const domainMax = Math.max(50, Math.ceil(maxValue / 50) * 50);

  return (
    <div className="h-[320px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 28, right: 24, left: 0, bottom: 4 }}>
          <defs>
            <linearGradient id="trend-leads" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={TREND_COLORS.leads} stopOpacity={0.28} />
              <stop offset="100%" stopColor={TREND_COLORS.leads} stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="trend-consultations" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={TREND_COLORS.consultations} stopOpacity={0.3} />
              <stop offset="100%" stopColor={TREND_COLORS.consultations} stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="trend-surgeries" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={TREND_COLORS.surgeries} stopOpacity={0.32} />
              <stop offset="100%" stopColor={TREND_COLORS.surgeries} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#eef2f7" />
          <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ ...AXIS_TICK, fill: "#64748b" }} dy={10} />
          <YAxis axisLine={false} tickLine={false} tick={AXIS_TICK} width={44} domain={[0, domainMax]} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Area
            type="monotone"
            dataKey="leads"
            name="Total Leads"
            stroke={TREND_COLORS.leads}
            strokeWidth={2.5}
            fill="url(#trend-leads)"
            dot={{ r: 4, fill: TREND_COLORS.leads, strokeWidth: 0 }}
            activeDot={{ r: 5 }}
            label={{ position: "top", fill: "#0f172a", fontSize: 12, fontWeight: 600 }}
          />
          <Area
            type="monotone"
            dataKey="consultations"
            name="Consultations Booked"
            stroke={TREND_COLORS.consultations}
            strokeWidth={2.5}
            fill="url(#trend-consultations)"
            dot={{ r: 4, fill: TREND_COLORS.consultations, strokeWidth: 0 }}
            activeDot={{ r: 5 }}
            label={{ position: "top", fill: "#0f172a", fontSize: 12, fontWeight: 600 }}
          />
          <Area
            type="monotone"
            dataKey="surgeries"
            name="Surgeries Completed"
            stroke={TREND_COLORS.surgeries}
            strokeWidth={2.5}
            fill="url(#trend-surgeries)"
            dot={{ r: 4, fill: TREND_COLORS.surgeries, strokeWidth: 0 }}
            activeDot={{ r: 5 }}
            label={{ position: "top", fill: "#0f172a", fontSize: 12, fontWeight: 600 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leads Pipeline by Stage (horizontal stacked bars, treatment-wise)
// ---------------------------------------------------------------------------

const hideZero = (value: unknown) => (typeof value === "number" && value > 0 ? String(value) : "");

function StageTick({ x, y, payload }: { x?: number; y?: number; payload?: { value?: string | number } }) {
  const label = String(payload?.value ?? "");
  const words = label.split(" ");
  const lines =
    words.length > 1 ? [words.slice(0, -1).join(" "), words[words.length - 1]] : [label];
  return (
    <text x={x} y={y} textAnchor="end" fill="#334155" fontSize={12}>
      {lines.map((line, index) => (
        <tspan key={line} x={x} dy={index === 0 ? (lines.length > 1 ? -2 : 4) : 14}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

export function PipelineChart({
  data,
  series,
}: {
  data: PipelineRow[];
  series?: TreatmentSeries[];
}) {
  const router = useRouter();
  // Treatments are discovered from the data, so the legend falls back to the
  // first row's cells when the caller does not pass an explicit series list.
  const activeSeries = useMemo<TreatmentSeries[]>(
    () => (series && series.length > 0 ? series : (data[0]?.series ?? [])),
    [data, series],
  );

  // Flatten { stage, series: [{key, value}] } into { stage, total, [key]: value }
  // so Recharts can stack arbitrarily many dynamic treatment keys.
  const flatData = useMemo<Record<string, string | number>[]>(
    () =>
      data.map((row) => {
        // `stageKey` carries the URL-safe stage id so segment clicks can drill
        // down into ?stage=... without a label → key lookup.
        const point: Record<string, string | number> = {
          stage: row.stage,
          stageKey: row.key,
          total: row.total,
        };
        for (const cell of row.series) point[cell.key] = cell.value;
        return point;
      }),
    [data],
  );

  const maxTotal = Math.max(...data.map((row) => row.total), 10);
  const domainMax = Math.max(100, Math.ceil(maxTotal / 100) * 100);
  const ticks = Array.from({ length: domainMax / 100 + 1 }, (_, index) => index * 100);

  // Clicking a stack segment drills into that stage + that treatment. The
  // folded "Other" segment carries every treatment NOT drawn explicitly, so the
  // server-side "other" resolution matches the visual bucket exactly.
  const handleSegmentClick = (point: unknown, treatmentKey: string) => {
    const payload = (point as { payload?: Record<string, string | number> } | null)?.payload;
    const stageKey = String(payload?.stageKey ?? "");
    if (!stageKey) return;
    const except =
      treatmentKey === "other"
        ? activeSeries
            .filter((entry) => entry.key !== "other" && entry.key !== "unrecorded")
            .map((entry) => entry.key)
            .join(",")
        : "";
    router.push(leadsHref({ stage: stageKey, treatment: treatmentKey, except }));
  };

  return (
    <div className="h-[320px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={flatData} layout="vertical" margin={{ top: 8, right: 56, left: 8, bottom: 4 }} barSize={30}>
          <CartesianGrid horizontal={false} stroke="#eef2f7" />
          <XAxis
            type="number"
            domain={[0, domainMax]}
            ticks={ticks}
            axisLine={false}
            tickLine={false}
            tick={AXIS_TICK}
          />
          <YAxis
            type="category"
            dataKey="stage"
            width={132}
            axisLine={false}
            tickLine={false}
            interval={0}
            tick={<StageTick />}
          />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          {activeSeries.map((entry) => (
            <Bar
              key={entry.key}
              dataKey={entry.key}
              name={entry.label}
              stackId="stage"
              fill={entry.color}
              onClick={(point) => handleSegmentClick(point, entry.key)}
            >
              <LabelList dataKey={entry.key} position="center" fill="#ffffff" fontSize={11} fontWeight={600} formatter={hideZero} />
            </Bar>
          ))}
          <Bar dataKey="total" name="Total" stackId="stage" fill="transparent" isAnimationActive={false}>
            <LabelList dataKey="total" position="right" fill="#0f172a" fontSize={13} fontWeight={700} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top Cities by Surgeries / Lead Source Performance (vertical bars)
// ---------------------------------------------------------------------------

function WrappedTick({ x, y, payload }: { x?: number; y?: number; payload?: { value?: string | number } }) {
  const label = String(payload?.value ?? "");
  const words = label.split(" ");
  const half = Math.ceil(words.length / 2);
  const lines = words.length > 2 ? [words.slice(0, half).join(" "), words.slice(half).join(" ")] : [label];
  return (
    <text x={x} y={y} textAnchor="middle" fill="#475569" fontSize={11}>
      {lines.map((line, index) => (
        <tspan key={line} x={x} dy={index === 0 ? 0 : 13}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

function CategoryBarChart({
  rows,
  dataKey,
  colors,
  wrapLabels = false,
  onRowClick,
}: {
  rows: BreakdownRow[];
  dataKey: "surgeries" | "leads";
  colors: string[];
  wrapLabels?: boolean;
  // When provided, clicking a bar drills into the matching lead list.
  onRowClick?: (row: BreakdownRow) => void;
}) {
  const maxValue = Math.max(...rows.map((row) => row[dataKey]), 1);
  const domainMax = Math.max(50, Math.ceil(maxValue / 50) * 50);

  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 26, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid vertical={false} stroke="#eef2f7" />
          <XAxis
            dataKey="label"
            interval={0}
            axisLine={false}
            tickLine={false}
            height={wrapLabels ? 46 : 30}
            tick={wrapLabels ? <WrappedTick /> : { ...AXIS_TICK, fill: "#475569", fontSize: 11 }}
            dy={wrapLabels ? 0 : 10}
          />
          <YAxis axisLine={false} tickLine={false} tick={AXIS_TICK} width={44} domain={[0, domainMax]} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Bar
            dataKey={dataKey}
            radius={[6, 6, 0, 0]}
            maxBarSize={72}
            cursor={onRowClick ? "pointer" : undefined}
            onClick={
              onRowClick
                ? (point) => {
                    const payload = (point as { payload?: BreakdownRow } | null)?.payload;
                    if (payload) onRowClick(payload);
                  }
                : undefined
            }
          >
            <LabelList dataKey={dataKey} position="top" fill="#0f172a" fontSize={12} fontWeight={600} />
            {rows.map((row, index) => (
              <Cell key={row.label} fill={colors[index % colors.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CitiesChart({ rows }: { rows: BreakdownRow[] }) {
  const router = useRouter();
  return (
    <CategoryBarChart
      rows={rows}
      dataKey="surgeries"
      colors={CITY_COLORS}
      onRowClick={(row) => {
        if (row.label && row.label !== "-") router.push(leadsHref({ city: row.label }));
      }}
    />
  );
}

export function SourcesChart({ rows }: { rows: BreakdownRow[] }) {
  const router = useRouter();
  return (
    <CategoryBarChart
      rows={rows}
      dataKey="leads"
      colors={SOURCE_COLORS}
      wrapLabels
      onRowClick={(row) => {
        if (row.label && row.label !== "-") router.push(leadsHref({ source: row.label }));
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Treatment coverage note (explains the grey "Not Recorded" segment)
// ---------------------------------------------------------------------------

/**
 * Shown under the pipeline chart. A CRM that never had a treatment column ends
 * up with a huge grey "Not Recorded" bar, which reads like a bug — this says, in
 * plain words, that the field is empty and how to fill it.
 */
export function TreatmentCoverageNote({
  coverage,
}: {
  coverage: { recorded: number; total: number };
}) {
  const missing = Math.max(coverage.total - coverage.recorded, 0);
  if (missing === 0 || coverage.total === 0) return null;
  const percent = Math.round((missing / coverage.total) * 100);

  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
      <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700">
        <span
          className="size-2.5 rounded-full"
          style={{ backgroundColor: TREATMENT_COLORS.unrecorded }}
          aria-hidden="true"
        />
        Not Recorded:
      </span>
      <span>
        {formatNumber(missing)} of {formatNumber(coverage.total)} funnel leads ({percent}%) have no treatment
        filled in — that is the grey bar. Fill the &ldquo;Treatment / Disease&rdquo; column in the Leads table and
        the chart shows each one under its own name — whatever you type (LASIK, Cataract, Hernia…) becomes a
        coloured segment automatically.
      </span>
    </p>
  );
}
