import Link from "next/link";
import { UserPlus, Users } from "lucide-react";

import type { TeamStats } from "@/app/actions/leads";
import { leadsHref, type LeadListFilters } from "../lead-filters";

export function AssignmentFilterTabs({
  team,
  filters,
}: {
  team: TeamStats;
  filters: LeadListFilters;
}) {
  const assigned = Math.max(0, team.total - team.unassigned);
  const tabs = [
    {
      key: "unassigned" as const,
      label: "Unassigned",
      count: team.unassigned,
      icon: UserPlus,
      activeClass: "border-amber-300 bg-amber-50 text-amber-900",
      inactiveClass: "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
      countClass: "bg-amber-100 text-amber-900",
    },
    {
      key: "assigned" as const,
      label: "Assigned",
      count: assigned,
      icon: Users,
      activeClass: "border-blue-300 bg-blue-50 text-blue-900",
      inactiveClass: "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
      countClass: "bg-blue-100 text-blue-900",
    },
  ];

  return (
    <nav aria-label="Filter leads by assignment" className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">Lead assignment</h2>
        <p className="mt-1 text-xs text-slate-500">
          Choose which leads to show. Counts include the full pipeline.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {tabs.map(({ key, label, count, icon: Icon, activeClass, inactiveClass, countClass }) => {
          const active = filters.assignmentStatus === key;
          return (
            <Link
              key={key}
              href={leadsHref({ ...filters, assigned: "", assignmentStatus: key })}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-12 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors ${
                active ? activeClass : inactiveClass
              }`}
            >
              <Icon className="size-4" aria-hidden="true" />
              {label}
              <span className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${countClass}`}>
                {count.toLocaleString()}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
