import Link from "next/link";
import { ChevronDown } from "lucide-react";

import type { TeamStats } from "@/app/actions/leads";
import { getInitials } from "@/lib/utils";
import { leadsHref, type LeadListFilters } from "./lead-filters";

function StatChip({ label, value, className, href, name, countLabel = "leads", reloadOnOpen = false }: { label: string; value: number; className: string; href: string; name: string; countLabel?: string; reloadOnOpen?: boolean }) {
  const content = (
    <>
      <p className="text-lg font-semibold leading-none tabular-nums">{value.toLocaleString()}</p>
      <p className="mt-1 min-h-6 text-[10px] font-medium leading-tight">{label}</p>
      {reloadOnOpen && <span className="text-[10px] font-semibold underline underline-offset-2">Open matching leads →</span>}
    </>
  );
  const classNames = `flex min-h-[58px] flex-col items-center justify-center rounded-lg px-1.5 py-1.5 text-center transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${className}`;
  const ariaLabel = `${name}: ${label}, ${value} ${countLabel}. View matching leads`;

  return reloadOnOpen
    ? <a href={`${href}#lead-list`} aria-label={ariaLabel} className={classNames}>{content}</a>
    : <Link href={`${href}#lead-list`} aria-label={ariaLabel} className={classNames}>{content}</Link>;
}

// Keep the full current-status breakdown available when an agent card expands.
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
          <details className="group/agent">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 [&::-webkit-details-marker]:hidden">
              <span className="flex min-w-0 items-center gap-3">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-100 to-slate-200 text-sm font-semibold text-slate-700 ring-1 ring-slate-200/70">
                  {getInitials(employee.name)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-slate-950">{employee.name}</span>
                  <span className="block text-xs text-slate-500">Tap to see all stats</span>
                </span>
              </span>
              <ChevronDown className="size-4 shrink-0 text-slate-500 transition-transform group-open/agent:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
            </summary>
            <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
              <div>
                <p className="mb-1.5 text-xs font-semibold text-slate-600">Lost review queue</p>
                <StatChip name={employee.name} href={leadsHref({ assigned: employee.name, bucket: "lost" })} label="Lost review queue" value={employee.lost} className="bg-rose-50 text-rose-700" />
              </div>
              <div>
                <p className="mb-1.5 text-xs font-semibold text-slate-600">All current dispositions · all dates</p>
                <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-5">
                  {PERMANENT_STATUSES.map((status) => (
                    <StatChip
                      key={status}
                      name={employee.name}
                      href={leadsHref({ assigned: employee.name, status })}
                      label={status}
                      value={employee.statuses[status] ?? 0}
                      className="bg-blue-50 text-blue-800"
                    />
                  ))}
                </div>
              </div>
              <p className="text-[10px] text-slate-500">Disposition counts are all-time. Appointment counts use this month&apos;s appointment dates.</p>
            </div>
          </details>
          <div className="mt-3">
            <p className="mb-1.5 text-xs font-semibold text-slate-600">Lead overview <span className="font-normal text-slate-500">· appointments {appointmentPeriodLabel(team.appointmentPeriod)}</span></p>
            <div className="grid grid-cols-3 gap-1.5">
              <StatChip name={employee.name} href={leadsHref({ assigned: employee.name })} label="Total leads" value={employee.total} className="bg-slate-100 text-slate-700" />
              <StatChip name={employee.name} href={leadsHref({ assigned: employee.name, bucket: "fresh" })} label="Fresh leads" value={employee.fresh} className="bg-blue-50 text-blue-700" />
              <StatChip name={employee.name} href={leadsHref({ assigned: employee.name, bucket: "new", allMonths: true })} label="New leads" value={employee.newLeads} className="bg-indigo-50 text-indigo-700" />
              <StatChip name={employee.name} href={leadsHref({ assigned: employee.name, bucket: "dnp" })} label="DNP" value={(employee.statuses.DNP ?? 0) + (employee.statuses.DNP2 ?? 0) + (employee.statuses.DNP3 ?? 0)} className="bg-amber-50 text-amber-800" />
              <StatChip name={employee.name} href={leadsHref({ assigned: employee.name, bucket: "followup" })} label="Follow up" value={employee.followUp} className="bg-sky-50 text-sky-700" />
              <StatChip name={employee.name} label="OPD Done" value={employee.opdDone} href={leadsHref({ assigned: employee.name, appointment: "opdDone", appointmentMonth: currentMonth })} reloadOnOpen className="bg-blue-50 text-blue-700" />
              <StatChip name={employee.name} label="OPD Booked" value={employee.opdBooked} href={leadsHref({ assigned: employee.name, appointment: "opdBooked", appointmentMonth: currentMonth })} reloadOnOpen className="bg-amber-50 text-amber-700" />
              <StatChip name={employee.name} label="IPD Done" value={employee.ipd} href={leadsHref({ assigned: employee.name, appointment: "ipdDone", appointmentMonth: currentMonth })} reloadOnOpen className="bg-purple-50 text-purple-700" />
              <StatChip name={employee.name} label="IPD Booked" value={employee.ipdBooked} href={leadsHref({ assigned: employee.name, appointment: "ipdBooked", appointmentMonth: currentMonth })} reloadOnOpen className="bg-violet-50 text-violet-700" />
            </div>
          </div>
        </article>
      ))}
    </section>
  );
}