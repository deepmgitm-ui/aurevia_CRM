import { Flame, UserPlus, Users } from "lucide-react";

import { getLeads } from "@/app/actions/leads";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { LeadsTable } from "./leads-table";

const statCards = [
  {
    label: "Total Leads",
    icon: Users,
    iconClassName: "bg-slate-100 text-slate-600",
  },
  {
    label: "New Leads",
    icon: UserPlus,
    iconClassName: "bg-blue-50 text-blue-600",
  },
  {
    label: "Hot Leads",
    icon: Flame,
    iconClassName: "bg-orange-50 text-orange-600",
  },
] as const;

export default async function DashboardPage() {
  const leadsResult = await getLeads();
  const leads = leadsResult.success ? leadsResult.data : [];

  const stats = {
    total: leads.length,
    new: leads.filter((lead) => lead.status === "New").length,
    hot: leads.filter((lead) => lead.temperature === "Hot").length,
  };

  const values = [stats.total, stats.new, stats.hot];

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
          Dashboard Overview
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Keep track of your pipeline and lead activity.
        </p>
      </div>

      <section
        aria-label="Lead statistics"
        className="grid grid-cols-1 gap-4 md:grid-cols-3"
      >
        {statCards.map(({ label, icon: Icon, iconClassName }, index) => (
          <Card key={label} className="border-0 shadow-sm">
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-slate-500">
                {label}
              </CardTitle>
              <span
                className={`flex size-10 items-center justify-center rounded-lg ${iconClassName}`}
              >
                <Icon className="size-5" aria-hidden="true" />
              </span>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold tracking-tight text-slate-950">
                {values[index]}
              </p>
            </CardContent>
          </Card>
        ))}
      </section>

      <LeadsTable leads={leads} />
    </div>
  );
}
