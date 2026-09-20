import Link from "next/link";
import { ArrowRight } from "lucide-react";

import type { TeamStats } from "@/app/actions/leads";

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function StatChip({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className={`rounded-lg px-2 py-2 text-center ${className}`}>
      <p className="text-lg font-semibold leading-none">{value}</p>
      <p className="mt-1 text-[11px] font-medium uppercase tracking-wide opacity-80">{label}</p>
    </div>
  );
}

// Team Overview: a grid of clickable employee cards. Clicking a card drills
// into that employee's leads (/dashboard?employee=<name>).
export function TeamOverview({ team }: { team: TeamStats }) {
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
        <Link
          key={employee.id}
          href={`/dashboard?employee=${encodeURIComponent(employee.name)}`}
          className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:border-slate-400 hover:shadow-md"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
                {getInitials(employee.name)}
              </span>
              <div>
                <p className="font-semibold text-slate-950 group-hover:underline">{employee.name}</p>
                <p className="text-xs text-slate-500">{employee.total.toLocaleString()} total leads</p>
              </div>
            </div>
            <ArrowRight
              className="size-4 shrink-0 text-slate-300 transition-all group-hover:translate-x-0.5 group-hover:text-slate-600"
              aria-hidden="true"
            />
          </div>
          <div className="mt-4 grid grid-cols-4 gap-2">
            <StatChip label="Hot" value={employee.hot} className="bg-orange-50 text-orange-700" />
            <StatChip label="Warm" value={employee.warm} className="bg-amber-50 text-amber-700" />
            <StatChip label="Cold" value={employee.cold} className="bg-sky-50 text-sky-700" />
            <StatChip label="New" value={employee.newLeads} className="bg-blue-50 text-blue-700" />
            <StatChip label="OPD Done" value={employee.opdDone} className="bg-emerald-50 text-emerald-700" />
            <StatChip label="Won" value={employee.won} className="bg-teal-50 text-teal-700" />
            <StatChip label="Lost" value={employee.lost} className="bg-rose-50 text-rose-700" />
            <StatChip label="Total" value={employee.total} className="bg-slate-100 text-slate-700" />
          </div>
        </Link>
      ))}
    </section>
  );
}