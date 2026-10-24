import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { leadsHref } from "./lead-filters";
import { LEAD_STATUS_OPTIONS } from "@/lib/lead-status";

export interface LeadPipelineCardsSummary {
  total: number;
  fresh: number;
  followUp: number;
  dnp: number;
  lost: number;
  opdBooked: number;
  opdDone: number;
  ipdBooked: number;
  ipdDone: number;
  statuses: Record<string, number>;
}

export function DashboardStats({
  summary,
  assignedTo,
  dailyNewLeads,
}: {
  summary: LeadPipelineCardsSummary;
  assignedTo?: string;
  dailyNewLeads?: { count: number | null; day: string };
}) {
  const scope = assignedTo ? { assigned: assignedTo } : {};
  const workflowCards = [
    ...(!dailyNewLeads ? [{ label: "Total Leads", value: summary.total, href: leadsHref({ ...scope, allMonths: true }), tone: "border-slate-200 bg-white text-slate-800" }] : []),
    ...(dailyNewLeads ? [{ label: "New Leads Today", value: dailyNewLeads.count, href: leadsHref({ ...scope, work: "assigned", day: dailyNewLeads.day, allMonths: true }), tone: "border-indigo-200 bg-indigo-50 text-indigo-800" }] : []),
    { label: "Fresh Leads", value: summary.fresh, href: leadsHref({ ...scope, bucket: "fresh", age: "", month: "", allMonths: true }), tone: "border-blue-200 bg-blue-50 text-blue-800" },
    { label: "Follow-up Work", value: summary.followUp, href: leadsHref({ ...scope, bucket: "followup", age: "", month: "", allMonths: true }), tone: "border-sky-200 bg-sky-50 text-sky-800" },
  ];
  const statusCards = LEAD_STATUS_OPTIONS.map((status) => ({
    label: status,
    value: summary.statuses[status] ?? 0,
    href: leadsHref({ ...scope, status, age: "", month: "", allMonths: true }),
    tone: status === "New" ? "border-blue-200 bg-blue-50 text-blue-800"
      : status.includes("OPD") ? (status === "OPD Done" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800")
      : status.includes("IPD") ? (status === "IPD Done" ? "border-purple-200 bg-purple-50 text-purple-800" : "border-violet-200 bg-violet-50 text-violet-800")
      : ["Dropped", "Not Interested", "Didn’t Enquired", "Budget Issue", "Location Issue", "Non Surgical", "Invalid Number", "Wrong Number"].includes(status) ? "border-rose-200 bg-rose-50 text-rose-800"
      : status === "Follow-Up" ? "border-sky-200 bg-sky-50 text-sky-800"
      : "border-slate-200 bg-white text-slate-800",
  }));

  const renderCard = (card: { label: string; value: number | null; href: string; tone: string }, index: number) => (
    <Link
      key={card.label}
      href={`${card.href}#lead-list`}
      style={{ animationDelay: `${index * 30}ms` }}
      aria-label={`${card.label}: ${card.value === null ? "unavailable" : card.value.toLocaleString()}. View matching leads`}
      className={`crm-motion-in crm-card-interactive rounded-xl border px-4 py-4 shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${card.tone}`}
    >
      <p className="text-xs font-semibold">{card.label}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums">{card.value === null ? "—" : card.value.toLocaleString()}</p>
      <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium">
        View leads <ArrowRight className="size-3" aria-hidden="true" />
      </span>
    </Link>
  );

  return (
    <div className="space-y-5">
      <section aria-label="Lead workflow summary" className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-800">Workflow overview</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{workflowCards.map(renderCard)}</div>
      </section>
      <section aria-label="Lead counts by current status" className="space-y-2">
        <div><h2 className="text-sm font-semibold text-slate-800">Leads by current status</h2><p className="mt-1 text-xs text-slate-500">Each status count opens only leads with that status.</p></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">{statusCards.map(renderCard)}</div>
      </section>
    </div>
  );
}
