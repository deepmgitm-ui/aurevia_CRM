"use client";

import { useState } from "react";
import { UserPlus, Users } from "lucide-react";

import type { TeamStats } from "@/app/actions/leads";
import { Card, CardContent } from "@/components/ui/card";

import { SmartAssignmentBanner } from "./smart-assignment";
import { TeamOverview } from "./team-overview";

type AssignmentTab = "unassigned" | "assigned";

export function LeadAssignmentTabs({ team }: { team: TeamStats }) {
  const [activeTab, setActiveTab] = useState<AssignmentTab>(
    "assigned",
  );
  const assigned = Math.max(0, team.total - team.unassigned);

  return (
    <section className="space-y-4" aria-label="Lead assignment overview">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-slate-950">Lead assignments</h2>
        <p className="text-sm text-slate-500">
          Check how many leads are still unassigned and how many each team member owns.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1" role="tablist" aria-label="Lead assignment status">
        <button
          id="unassigned-leads-tab"
          type="button"
          role="tab"
          aria-selected={activeTab === "unassigned"}
          aria-controls="unassigned-leads-panel"
          onClick={() => setActiveTab("unassigned")}
          tabIndex={activeTab === "unassigned" ? 0 : -1}
          className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
            activeTab === "unassigned"
              ? "bg-white text-amber-800 shadow-sm"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <UserPlus className="size-4" aria-hidden="true" />
          Unassigned
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs tabular-nums text-amber-900">
            {team.unassigned.toLocaleString()}
          </span>
        </button>
        <button
          id="assigned-leads-tab"
          type="button"
          role="tab"
          aria-selected={activeTab === "assigned"}
          aria-controls="assigned-leads-panel"
          onClick={() => setActiveTab("assigned")}
          tabIndex={activeTab === "assigned" ? 0 : -1}
          className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
            activeTab === "assigned"
              ? "bg-white text-blue-800 shadow-sm"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <Users className="size-4" aria-hidden="true" />
          Assigned
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs tabular-nums text-blue-900">
            {assigned.toLocaleString()}
          </span>
        </button>
      </div>

      <div
        id="unassigned-leads-panel"
        role="tabpanel"
        aria-labelledby="unassigned-leads-tab"
        hidden={activeTab !== "unassigned"}
        className="space-y-3"
      >
        <Card className="border-amber-200 bg-amber-50/70 shadow-sm">
          <CardContent className="flex flex-col gap-1 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-amber-900">Leads left to assign</p>
              <p className="text-3xl font-semibold tracking-tight text-amber-950 tabular-nums">
                {team.unassigned.toLocaleString()}
              </p>
            </div>
            <p className="max-w-md text-xs text-amber-800">
              Includes leads without a matching team member assignment. Assign them to make follow-up ownership clear.
            </p>
          </CardContent>
        </Card>
        {team.unassigned > 0 ? (
          <SmartAssignmentBanner
            unassigned={team.unassigned}
            employees={team.employees.map(({ id, name }) => ({ id, name }))}
          />
        ) : (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            All leads are assigned.
          </p>
        )}
      </div>
      <div
        id="assigned-leads-panel"
        role="tabpanel"
        aria-labelledby="assigned-leads-tab"
        hidden={activeTab !== "assigned"}
        className="space-y-4"
      >
        <Card className="border-blue-200 bg-blue-50/70 shadow-sm">
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="text-sm font-medium text-blue-900">Assigned leads</p>
              <p className="text-3xl font-semibold tracking-tight text-blue-950 tabular-nums">
                {assigned.toLocaleString()}
              </p>
            </div>
            <p className="text-right text-xs text-blue-800">
              Across {team.employees.length.toLocaleString()} team member
              {team.employees.length === 1 ? "" : "s"}
            </p>
          </CardContent>
        </Card>
        <TeamOverview team={team} />
      </div>
    </section>
  );
}
