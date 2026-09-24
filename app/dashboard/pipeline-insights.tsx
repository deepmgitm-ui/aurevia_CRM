import type { PipelineInsights } from "@/app/actions/leads";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function BarList({ items }: { items: Array<{ label: string; count: number }> }) {
  const max = Math.max(1, ...items.map((item) => item.count));
  if (items.length === 0) {
    return <p className="text-sm text-slate-400">No data yet.</p>;
  }
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.label}>
          <div className="mb-1 flex items-center justify-between gap-3 text-xs">
            <span className="truncate font-medium text-slate-700">{item.label}</span>
            <span className="font-semibold text-slate-900">{item.count}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-slate-800" style={{ width: `${Math.max(4, Math.round((item.count / max) * 100))}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function PipelineInsights({ insights }: { insights: PipelineInsights }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-950">Pipeline Insights</h2>
        <p className="mt-1 text-sm text-slate-500">Operational metrics calculated from the leads you can access.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {[
          { label: "Open", value: insights.open },
          { label: "Won", value: insights.won },
          { label: "Lost", value: insights.lost },
          { label: "Conversion", value: `${insights.conversionRate}%` },
          { label: "Overdue", value: insights.overdueFollowUps },
        ].map((item) => (
          <Card key={item.label} className="border-0 shadow-sm">
            <CardContent className="p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{item.label}</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950">{item.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-0 shadow-sm">
          <CardHeader><CardTitle className="text-base">Lead Sources</CardTitle></CardHeader>
          <CardContent><BarList items={insights.bySource} /></CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardHeader><CardTitle className="text-base">Pipeline Status</CardTitle></CardHeader>
          <CardContent><BarList items={insights.byStatus} /></CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardHeader><CardTitle className="text-base">Temperature</CardTitle></CardHeader>
          <CardContent><BarList items={insights.byTemperature} /></CardContent>
        </Card>
      </div>
    </section>
  );
}
