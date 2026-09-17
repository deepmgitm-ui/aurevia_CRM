import { Flame, ListChecks, Target, Trophy } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Lead } from "@/app/actions/leads";

export function DashboardStats({ leads }: { leads: Lead[] }) {
  const total = leads.length;
  const hot = leads.filter((lead) => lead.temperature === "Hot" || lead.temperature === "Hot 🔥").length;
  const won = leads.filter((lead) => lead.status === "Won").length;
  const lost = leads.filter((lead) => lead.status === "Lost").length;
  const percentage = (count: number) => total === 0 ? 0 : Math.round((count / total) * 100);

  const stats = [
    { label: "Total Leads", value: total, icon: ListChecks, color: "text-slate-600", background: "bg-slate-100" },
    { label: "Hot Leads", value: hot, icon: Flame, color: "text-orange-600", background: "bg-orange-50" },
    { label: "Won Leads", value: won, icon: Trophy, color: "text-emerald-600", background: "bg-emerald-50", percent: percentage(won) },
    { label: "Lost Leads", value: lost, icon: Target, color: "text-rose-600", background: "bg-rose-50", percent: percentage(lost) },
  ];

  return (
    <section aria-label="Lead analytics" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {stats.map(({ label, value, icon: Icon, color, background, percent }) => (
        <Card key={label} className="border-0 shadow-sm">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">{label}</CardTitle>
            <span className={`flex size-9 items-center justify-center rounded-lg ${background} ${color}`}>
              <Icon className="size-4" aria-hidden="true" />
            </span>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
            {percent !== undefined && (
              <div className="mt-3 space-y-1.5">
                <div className="flex justify-between text-xs text-slate-500"><span>Share of pipeline</span><span>{percent}%</span></div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${label === "Won Leads" ? "bg-emerald-500" : "bg-rose-500"}`} style={{ width: `${percent}%` }} /></div>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
