"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";

import { leadsHref } from "./lead-filters";
import { LEAD_STATUS_OPTIONS } from "@/lib/lead-status";

export interface LeadPipelineCardsSummary {
  total: number;
  new: number;
  fresh: number;
  nextFreshAt?: string | null;
  followUp: number;
  dnp: number;
  lost: number;
  opdBooked: number;
  opdDone: number;
  ipdBooked: number;
  ipdDone: number;
  statuses: Record<string, number>;
  appointmentPeriod: { from: string; to: string };
}

const MONTHLY_APPOINTMENT_STATUSES = new Set(["OPD Booked", "OPD Done", "IPD Booked", "IPD Done"]);

function monthlyAppointmentLabel(period: { from: string; to: string }): string {
  const from = new Date(period.from + "T12:00:00Z");
  const to = new Date(period.to + "T12:00:00Z");
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) return "Current calendar month";
  const monthYear = new Intl.DateTimeFormat("en-IN", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(to);
  return String(from.getUTCDate()) + "–" + String(to.getUTCDate()) + " " + monthYear;
}

export function DashboardStats({
  summary,
  assignedTo,
  dailyNewLeads,
  showTotal,
}: {
  summary: LeadPipelineCardsSummary;
  assignedTo?: string;
  dailyNewLeads?: { count: number | null; day: string };
  showTotal?: boolean;
}) {
  const router = useRouter();
  useEffect(() => {
    if (!summary.nextFreshAt) return;
    const dueAt = Date.parse(summary.nextFreshAt);
    if (!Number.isFinite(dueAt)) return;
    const timer = window.setTimeout(() => router.refresh(), Math.max(0, dueAt - Date.now() + 25));
    return () => window.clearTimeout(timer);
  }, [router, summary.nextFreshAt]);
  const scope = assignedTo ? { assigned: assignedTo } : {};
  const workflowCards = [
    ...((showTotal ?? !dailyNewLeads) ? [{ label: "Total Leads", value: summary.total, href: leadsHref({ ...scope, allMonths: true }), tone: "border-slate-200 bg-white text-slate-800" }] : []),
    { label: "New", detail: "Untouched leads carried over from earlier days.", value: summary.new, href: leadsHref({ ...scope, bucket: "new", age: "", month: "", allMonths: true }), tone: "border-indigo-200 bg-indigo-50 text-indigo-800" },
    { label: "Fresh", detail: "Today's newly added leads. Untouched leads move to New at midnight.", value: summary.fresh, href: leadsHref({ ...scope, bucket: "fresh", age: "", month: "", allMonths: true }), tone: "border-blue-200 bg-blue-50 text-blue-800" },
    { label: "Follow Up Work", detail: "Today's scheduled callbacks and pending tasks.", value: summary.followUp, href: leadsHref({ ...scope, bucket: "followup", age: "", month: "", allMonths: true }), tone: "border-sky-200 bg-sky-50 text-sky-800" },
  ];
  // New and Fresh share the stored untouched bucket; their displayed counts
  // split at India midnight, so Fresh resets every clinic day.
  const statusCards = LEAD_STATUS_OPTIONS.filter((status) => status !== "New" && !MONTHLY_APPOINTMENT_STATUSES.has(status)).map((status) => ({
    label: status === "Dropped" ? "Lost" : status === "IPD Done" ? "Converted / Won" : status,
    detail: status === "Follow-Up" ? "Contacted leads scheduled for a specific callback date."
      : status === "DNP" || status.startsWith("DNP") ? "Attempted calls with no response. Needs retry."
      : status === "Dropped" ? "Uninterested or disqualified leads. Pending review/deletion."
      : status === "OPD Done" || status === "IPD Done" ? "Successfully closed leads."
      : undefined,
    value: summary.statuses[status] ?? 0,
    href: leadsHref({ ...scope, status, age: "", month: "", allMonths: true }),
    tone: status.includes("OPD") ? (status === "OPD Done" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800")
      : status.includes("IPD") ? (status === "IPD Done" ? "border-purple-200 bg-purple-50 text-purple-800" : "border-violet-200 bg-violet-50 text-violet-800")
      : ["Dropped", "Not Interested", "Didn’t Enquired", "Budget Issue", "Location Issue", "Non Surgical", "Invalid Number", "Wrong Number"].includes(status) ? "border-rose-200 bg-rose-50 text-rose-800"
      : status === "Follow-Up" ? "border-sky-200 bg-sky-50 text-sky-800"
      : "border-slate-200 bg-white text-slate-800",
  }));

  const monthlyAppointmentCards = [
    { label: "OPD Booked", value: summary.opdBooked, tone: "border-amber-200 bg-amber-50 text-amber-800" },
    { label: "OPD Done", value: summary.opdDone, tone: "border-emerald-200 bg-emerald-50 text-emerald-800" },
    { label: "IPD Booked", value: summary.ipdBooked, tone: "border-violet-200 bg-violet-50 text-violet-800" },
    { label: "IPD Done", value: summary.ipdDone, tone: "border-purple-200 bg-purple-50 text-purple-800" },
  ];

  const renderCard = (card: { label: string; detail?: string; value: number | null; href: string; tone: string }, index: number) => (
    <Link
      key={card.label}
      href={`${card.href}#lead-list`}
      style={{ animationDelay: `${index * 30}ms` }}
      aria-label={`${card.label}: ${card.value === null ? "unavailable" : card.value.toLocaleString()}. View matching leads`}
      className={`crm-motion-in crm-card-interactive rounded-lg border px-3 py-3 shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${card.tone}`}
    >
      <p className="text-[11px] font-semibold leading-snug">{card.label}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums">{card.value === null ? "—" : card.value.toLocaleString()}</p>
      {card.detail && <p className="mt-1 text-[11px] leading-snug opacity-80">{card.detail}</p>}
      <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium">
        View leads <ArrowRight className="size-3" aria-hidden="true" />
      </span>
    </Link>
  );

  return (
    <div className="space-y-5">
      <section aria-label="Lead workflow summary" className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-800">Workflow overview</h2>
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">{workflowCards.map(renderCard)}</div>
      </section>
      <section aria-label="Lead counts by current status" className="space-y-2">
        <div><h2 className="text-sm font-semibold text-slate-800">Permanent disposition counts</h2><p className="mt-1 text-xs text-slate-500">Counts show each lead&apos;s current disposition across all dates. They do not reset monthly. Follow-Up Work above is an untouched-work queue.</p></div>
        <div className="grid gap-2.5 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">{statusCards.map(renderCard)}</div>
      </section>
      <section aria-label="Monthly appointment counts" className="space-y-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Monthly appointment counts</h2>
          <p className="mt-1 text-xs text-slate-500">Appointments dated {monthlyAppointmentLabel(summary.appointmentPeriod)}. These counts start over on the 1st of each month.</p>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {monthlyAppointmentCards.map((card) => (
            <div key={card.label} aria-label={card.label + ": " + card.value.toLocaleString() + " this month"} className={"crm-motion-in rounded-lg border px-3 py-3 shadow-sm " + card.tone}>
              <p className="text-[11px] font-semibold leading-snug">{card.label}</p>
              <p className="mt-1.5 text-2xl font-semibold tabular-nums">{card.value.toLocaleString()}</p>
              <p className="mt-1 text-[11px] leading-snug opacity-80">This month</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
