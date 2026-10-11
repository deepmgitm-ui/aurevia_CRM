import Link from "next/link";
import { ArrowRight } from "lucide-react";

import type { TeamStats } from "@/app/actions/leads";
import { leadsHref } from "./lead-filters";

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function StatChip({ label, value, className, href, name }: { label: string; value: number; className: string; href: string; name: string }) {
  return (
    <Link href={`${href}#lead-list`} aria-label={`${name}: ${label}, ${value} leads. View leads`} className={`rounded-lg px-2 py-3 text-center transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${className}`}>
      <p className="text-xl font-semibold leading-none tabular-nums">{value.toLocaleString()}</p>
      <p className="mt-2 text-xs font-medium">{label}</p>
    </Link>
  );
}

// Each metric opens the same agent's leads with the corresponding status.
export function TeamOverview({
  team,
}: {
  team: TeamStats;
}) {
  if (team.employees.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No team members found yet. Add employees from the settings page to see their lead stats here.
      </p>
    );
  }

  return (
    <section aria-label="Team overview" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {team.employees.map((employee) => (
        <article
          key={employee.id}
          className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:border-slate-400 hover:shadow-md"
        >
          <Link href={`${leadsHref({ assigned: employee.name })}#lead-list`} className="flex items-center justify-between rounded-lg focus-visible:outline-2 focus-visible:outline-blue-600">
            <div className="flex items-center gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
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
            <StatChip name={employee.name} href={leadsHref({ assigned: employee.name })} label="Total leads" value={employee.total} className="col-span-2 bg-slate-100 text-slate-700" />
            <StatChip name={employee.name} href={leadsHref({ assigned: employee.name, status: "New" })} label="Fresh leads" value={employee.newLeads} className="bg-blue-50 text-blue-700" />
            <StatChip name={employee.name} href={leadsHref({ assigned: employee.name, status: "OPD Booked" })} label="OPD booked" value={employee.opdBooked} className="bg-amber-50 text-amber-700" />
            <StatChip name={employee.name} href={leadsHref({ assigned: employee.name, status: "OPD Done" })} label="OPD Done" value={employee.opdDone} className="bg-emerald-50 text-emerald-700" />
            <StatChip name={employee.name} href={leadsHref({ assigned: employee.name, status: "IPD Done" })} label="IPD" value={employee.ipd} className="bg-violet-50 text-violet-700" />
          </div>
          <p className="mt-3 text-[11px] text-slate-500">Tap a count to view leads · Fresh = New · IPD = IPD Done</p>
        </article>
      ))}
    </section>
  );
}
