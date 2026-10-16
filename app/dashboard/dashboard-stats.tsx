import { ListChecks } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
export function DashboardStats({ total }: { total: number }) {
  return (
    <section aria-label="Lead count" className="w-full max-w-sm">
      <Card className="crm-motion-in crm-card-interactive border border-slate-100 shadow-sm hover:shadow-lg">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-slate-500">Total Leads</CardTitle>
          <span className="flex size-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <ListChecks className="size-4" aria-hidden="true" />
          </span>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold tracking-tight text-slate-950">{total.toLocaleString()}</p>
        </CardContent>
      </Card>
    </section>
  );
}
