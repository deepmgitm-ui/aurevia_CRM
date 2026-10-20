import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { leadsHref } from "./lead-filters";

export interface LeadPipelineCardsSummary {
  total: number;
  fresh: number;
  opdBooked: number;
  opdDone: number;
  ipd: number;
}

export function DashboardStats({
  summary,
  assignedTo,
}: {
  summary: LeadPipelineCardsSummary;
  assignedTo?: string;
}) {
  const scope = assignedTo ? { assigned: assignedTo } : {};
  const cards = [
    { label: "Total Leads", value: summary.total, status: "", tone: "border-slate-200 bg-white text-slate-800" },
    { label: "Fresh Leads", value: summary.fresh, status: "New", tone: "border-blue-200 bg-blue-50 text-blue-800" },
    { label: "OPD Booked", value: summary.opdBooked, status: "OPD Booked", tone: "border-amber-200 bg-amber-50 text-amber-800" },
    { label: "OPD Done", value: summary.opdDone, status: "OPD Done", tone: "border-emerald-200 bg-emerald-50 text-emerald-800" },
    { label: "IPD", value: summary.ipd, status: "IPD Done", tone: "border-violet-200 bg-violet-50 text-violet-800" },
  ];

  return (
    <section aria-label="Lead pipeline" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {cards.map((card, index) => {
        const href = leadsHref({
          ...scope,
          status: card.status,
          age: "",
          month: "",
          allMonths: true,
        });
        return (
          <Link
            key={card.label}
            href={`${href}#lead-list`}
            style={{ animationDelay: `${index * 45}ms` }}
            aria-label={`${card.label}: ${card.value.toLocaleString()}. View matching leads`}
            className={`crm-motion-in crm-card-interactive rounded-xl border px-4 py-4 shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${card.tone}`}
          >
            <p className="text-xs font-semibold">{card.label}</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">{card.value.toLocaleString()}</p>
            <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium">
              View leads <ArrowRight className="size-3" aria-hidden="true" />
            </span>
          </Link>
        );
      })}
    </section>
  );
}
