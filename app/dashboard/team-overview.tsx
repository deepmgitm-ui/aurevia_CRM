import Link from "next/link";
import { ArrowRight } from "lucide-react";

import type { TeamStats } from "@/app/actions/leads";
import { getInitials } from "@/lib/utils";
import { leadsHref, type LeadListFilters } from "./lead-filters";

function StatChip({ label, value, className, href, name }: { label: string; value: number; className: string; href: string; name: string }) {
  return (
    <Link href={`${href}#lead-list`} aria-label={`${name}: ${label}, ${value} leads. View leads`} className={`rounded-lg px-2 py-3 text-center transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${className}`}>
      <p className="text-xl font-semibold leading-none tabular-nums">{value.toLocaleString()}</p>
      <p className="mt-2 text-xs font-medium">{label}</p>
    </Link>
  );
}

// Each metric opens the same agent's exact workflow bucket.
export function TeamOverview({
  team,
  filters,
}: {
  team: TeamStats;
  filters?: Pick<LeadListFilters, "assigned">;
}) {
  const assignedFilter = filters?.assigned ?? "";
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
          className="crm-motion-in crm-card-interactive group rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm hover:border-slate-300 hover:shadow-lg"
        >
          <Link href={`${leadsHref({ assigned: employee.name })}#lead-list`} className="flex items-center justify-between rounded-lg focus-visible:outline-2 focus-visible:outline-blue-600">
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
              className="size-4 shrink-0 text-slate-300 transition-all group-hover:translate-x-0.5 group-hover:text-slate-600"
              aria-hidden="true"
            />
          </Link>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <StatChip name={employee.name} href={leadsHref({ assigned: employee.name })} label="Total leads" value={employee.total} className="bg-slate-100 text-slate-700" />
            <StatChip name={employee.name} href={leadsHref({ assigned: employee.name, bucket: "fresh" })} label="Fresh leads" value={employee.fresh} className="bg-blue-50 text-blue-700" />
            <StatChip name={employee.name} href={leadsHref({ assigned: employee.name, bucket: "followup" })} label="Follow-up" value={employee.followUp} className="bg-sky-50 text-sky-700" />
            <StatChip name={employee.name} href={leadsHref({ assigned: employee.name, bucket: "lost" })} label="Lost leads" value={employee.lost} className="bg-rose-50 text-rose-700" />
            <StatChip name={employee.name} href={leadsHref({ assigned: employee.name, bucket: "opdBooked" })} label="OPD booked" value={employee.opdBooked} className="bg-amber-50 text-amber-700" />
            <StatChip name={employee.name} href={leadsHref({ assigned: employee.name, bucket: "opdDone" })} label="OPD Done" value={employee.opdDone} className="bg-emerald-50 text-emerald-700" />
            <StatChip name={employee.name} href={leadsHref({ assigned: employee.name, bucket: "ipdBooked" })} label="IPD booked" value={employee.ipdBooked} className="bg-violet-50 text-violet-700" />
            <StatChip name={employee.name} href={leadsHref({ assigned: employee.name, bucket: "ipdDone" })} label="IPD Done" value={employee.ipd} className="bg-purple-50 text-purple-700" />
          </div>
          <p className="mt-3 text-[11px] text-slate-500">Select a count to view only the matching leads.</p>
        </article>
      ))}
    </section>
  );
}
