"use client";

// ---------------------------------------------------------------------------
// The six pastel KPI scorecards (Total Leads → Active Agents).
// ---------------------------------------------------------------------------

import {
  CalendarCheck,
  Eye,
  Percent,
  TrendingUp,
  UserMinus,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

import Link from "next/link";

import { leadsHref } from "../lead-filters";
import { MiniBars } from "./charts";
import type { KpiCard, KpiKey } from "./analytics";

/**
 * Drill-down target per KPI card — mirrors the KPI math in analytics.ts
 * (consultations = booked + attended + surgery, surgeries = surgery,
 * lost = lost). conversionRate is a ratio over all leads, so it stays inert.
 */
const KPI_DRILL_HREF: Partial<Record<KpiKey, string>> = {
  totalLeads: "/dashboard/leads",
  consultationsBooked: leadsHref({ stage: "booked,attended,surgery" }),
  surgeriesCompleted: leadsHref({ stage: "surgery" }),
  lostLeads: leadsHref({ stage: "lost" }),
  activeAgents: "/dashboard/agents",
};

const KPI_ICONS: Record<KpiKey, LucideIcon> = {
  totalLeads: Users,
  consultationsBooked: CalendarCheck,
  surgeriesCompleted: Eye,
  lostLeads: UserMinus,
  conversionRate: Percent,
  activeAgents: UsersRound,
};

const KPI_TONES: Record<KpiKey, { card: string; icon: string; bar: string }> = {
  totalLeads: { card: "border-blue-100 bg-blue-50", icon: "bg-blue-100 text-blue-600", bar: "#3b82f6" },
  consultationsBooked: {
    card: "border-emerald-100 bg-emerald-50",
    icon: "bg-emerald-100 text-emerald-600",
    bar: "#10b981",
  },
  surgeriesCompleted: { card: "border-orange-100 bg-orange-50", icon: "bg-orange-100 text-orange-500", bar: "#f97316" },
  lostLeads: { card: "border-violet-100 bg-violet-50", icon: "bg-violet-100 text-violet-600", bar: "#8b5cf6" },
  conversionRate: { card: "border-pink-100 bg-pink-50", icon: "bg-pink-100 text-pink-600", bar: "#ec4899" },
  activeAgents: { card: "border-teal-100 bg-teal-50", icon: "bg-teal-100 text-teal-600", bar: "#14b8a6" },
};

const KPI_SUBTITLES: Partial<Record<KpiKey, string>> = {
  conversionRate: "(Lead to Surgery)",
};

export function KpiCards({ kpis }: { kpis: KpiCard[] }) {
  return (
    <section aria-label="Key performance indicators" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {kpis.map((kpi) => {
        const tone = KPI_TONES[kpi.key];
        const Icon = KPI_ICONS[kpi.key];
        const wentUp = !kpi.delta.startsWith("-");
        const isFlat = kpi.delta.replace(/^[+-]/, "") === "0.0%";
        // Fewer lost leads is better, so that card inverts the good/bad colour.
        const isGood = kpi.key === "lostLeads" ? !wentUp : wentUp;
        const trendClass = isFlat
          ? "text-slate-500"
          : isGood
            ? "text-emerald-600"
            : "text-rose-600";
        const cardClass = `flex flex-col justify-between rounded-2xl border p-4 shadow-sm transition-shadow hover:shadow-md ${tone.card}`;
        const drillHref = KPI_DRILL_HREF[kpi.key];
        const body = (
          <>
            <div className="flex items-start gap-3">
              <span className={`flex size-12 shrink-0 items-center justify-center rounded-2xl ${tone.icon}`}>
                <Icon className="size-6" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-sm leading-tight font-semibold text-slate-800">{kpi.label}</p>
                {KPI_SUBTITLES[kpi.key] && (
                  <p className="text-[11px] leading-tight text-slate-500">{KPI_SUBTITLES[kpi.key]}</p>
                )}
                <p className="mt-1 text-2xl font-bold tracking-tight text-slate-900 xl:text-[28px]">{kpi.value}</p>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className={`flex items-center gap-1 text-xs font-semibold ${trendClass}`}>
                <TrendingUp className={`size-3.5 ${wentUp ? "" : "rotate-180"}`} aria-hidden="true" />
                {kpi.delta}
              </span>
              <MiniBars color={tone.bar} />
            </div>
          </>
        );
        // Cards with a meaningful lead set become links into the filtered list;
        // conversionRate (a ratio) stays a plain card.
        if (drillHref) {
          return (
            <Link
              key={kpi.key}
              href={drillHref}
              aria-label={`View leads for ${kpi.label}`}
              className={`${cardClass} ring-blue-300 focus-visible:outline-none focus-visible:ring-2`}
            >
              {body}
            </Link>
          );
        }
        return (
          <div key={kpi.key} className={cardClass}>
            {body}
          </div>
        );
      })}
    </section>
  );
}
