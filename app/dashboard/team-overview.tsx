import Link from "next/link";
import { ArrowRight } from "lucide-react";

import type { TeamStats } from "@/app/actions/leads";
import { getInitials } from "@/lib/utils";
import { leadsHref, type LeadListFilters } from "./lead-filters";

function StatChip({ label, value, className, href, name, countLabel = "leads" }: { label: string; value: number; className: string; href: string; name: string; countLabel?: string }) {
  return (
    <Link href={`${href}#lead-list`} aria-label={`${name}: ${label}, ${value} ${countLabel}. View matching leads`} className={`flex min-h-[58px] flex-col items-center justify-center rounded-lg px-1.5 py-1.5 text-center transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${className}`}>
      <p className="text-lg font-semibold leading-none tabular-nums">{value.toLocaleString()}</p>
      <p className="mt-1 min-h-6 text-[10px] font-medium leading-tight">{label}</p>
    </Link>
  );
}

// Each metric opens the same agent's exact workflow bucket.
const PERMANENT_STATUSES = [
  "DNP", "DNP2", "DNP3", "RNR", "Not Interested", "Didn't Enquired",
  "Budget Issue", "Location Issue", "Language Issue", "Non Surgical",
  "Dropped", "Invalid Number", "CallBack", "Wrong Number", "Follow-Up",
] as const;

function appointmentPeriodLabel(period: { from: string; to: string }): string {
  const from = new Date(period.from + "T12:00:00Z");
  const to = new Date(period.to + "T12:00:00Z");
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) return "This calendar month";
  const monthYear = new Intl.DateTimeFormat("en-IN", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(to);
  return String(from.getUTCDate()) + "–" + String(to.getUTCDate()) + " " + monthYear;
}
export function TeamOverview({
  team,
  filters,
}: {
  team: TeamStats;
  filters?: Pick<LeadListFilters, "assigned">;
}) {
  const assignedFilter = filters?.assigned ?? "";
  const currentMonth = team.appointmentPeriod.from.slice(0, 7);
  const employees = assignedFilter
    ? team.employees.filter((employee) => employee.name.toLocaleLowerCase() === assignedFilter.toLocaleLowerCase())
    : team.employees;

  if (employees.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        {assignedFilter
          ? "No matching agent summary is available for this selection."
          : "No team members found yet. Add employees from the settings page to see their lead stats here."}
      </p>
    );
  }

  return (
    <section aria-label="Team overview" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {employees.map((employee, index) => (
        <article
          key={employee.id}
          style={{ animationDelay: `${index * 55}ms` }}
          className="crm-motion-in crm-card-interactive group rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm hover:border-slate-300 hover:shadow-lg"
        >
          <Link href={`${leadsHref({ assigned: employee.name, month: currentMonth })}#lead-list`} className="flex items-center justify-between rounded-lg focus-visible:outline-2 focus-visible:outline-blue-600">
            <div className="flex items-center gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-100 to-slate-200 text-sm font-semibold text-slate-700 ring-1 ring-slate-200/70 transition-transform duration-200 group-hover:scale-105 motion-reduce:transition-none">
                {getInitials(employee.name)}
              </span>
              <div>
                <p className="font-semibold text-slate-950 group-hover:underline">{employee.name}</p>
                <p className="text-xs text-slate-500">
                  {employee.total.toLocaleString()} total leads · View leads
                </p>
              </div>
            </div>
            <ArrowRight
              className="size-4 shrink-0 text-slate-300 transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-slate-600"
              aria-hidden="true"
            />
          </Link>
          <div className="mt-3">
            <p className="mb-1.5 text-xs font-semibold text-slate-600">Lead workflow</p>
            <div className="grid grid-cols-2 gap-1.5">
            <StatChip name={employee.name} href={leadsHref({ assigned: employee.name })} label="Total leads" value={employee.total} className="bg-slate-100 text-slate-700" />
            <StatChip name={employee.name} href={leadsHref({ assigned: employee.name, bucket: "new", allMonths: true })} label="New (untouched carryover)" value={employee.newLeads} className="bg-indigo-50 text-indigo-700" />
            <StatChip name={employee.name} href={leadsHref({ assigned: employee.name, bucket: "fresh" })} label="Fresh (today)" value={employee.fresh} className="bg-blue-50 text-blue-700" />
            <StatChip name={employee.name} href={leadsHref({ assigned: employee.name, bucket: "followup" })} label="Follow-up work" value={employee.followUp} className="bg-sky-50 text-sky-700" />
            <StatChip name={employee.name} href={leadsHref({ assigned: employee.name, bucket: "lost" })} label="Lost review queue" value={employee.lost} className="bg-rose-50 text-rose-700" />
            </div>
          </div>
          <div className="mt-3">
            <p className="mb-1.5 text-xs font-semibold text-slate-600">Permanent current dispositions · all dates</p>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-5">
              {PERMANENT_STATUSES.map((status) => (
                <StatChip
                  key={status}
                  name={employee.name}
                  href={leadsHref({ assigned: employee.name, status })}
                  label={status}
                  value={employee.statuses[status] ?? 0}
                  className="bg-emerald-50 text-emerald-800"
                />
              ))}
            </div>
          </div>
          <div className="mt-3">
            <p className="mb-1.5 text-xs font-semibold text-slate-600">Monthly appointments · {appointmentPeriodLabel(team.appointmentPeriod)}</p>
            <div className="grid grid-cols-2 gap-1.5">
              <StatChip name={employee.name} label="OPD Booked" countLabel="appointments" value={employee.opdBooked} href={leadsHref({ assigned: employee.name, bucket: "opdBooked", month: currentMonth })} className="bg-amber-50 text-amber-700" />
              <StatChip name={employee.name} label="OPD Done" countLabel="appointments" value={employee.opdDone} href={leadsHref({ assigned: employee.name, bucket: "opdDone", month: currentMonth })} className="bg-emerald-50 text-emerald-700" />
              <StatChip name={employee.name} label="IPD Booked" countLabel="appointments" value={employee.ipdBooked} href={leadsHref({ assigned: employee.name, bucket: "ipdBooked", month: currentMonth })} className="bg-violet-50 text-violet-700" />
              <StatChip name={employee.name} label="IPD Done" countLabel="appointments" value={employee.ipd} href={leadsHref({ assigned: employee.name, bucket: "ipdDone", month: currentMonth })} className="bg-purple-50 text-purple-700" />
            </div>
          </div>
          <p className="mt-2 text-[10px] text-slate-500">Permanent disposition counts never reset monthly. Appointment totals use this month&apos;s appointment dates.</p>
        </article>
      ))}
    </section>
  );
}
