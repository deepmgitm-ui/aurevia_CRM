"use client";
import type { AgentDailyRow } from "@/app/actions/crm-workflows";
import { Button } from "@/components/ui/button";
const columns = [
  ["assigned", "Assigned"],
  ["calls", "Calls logged"],
  ["patients_called", "Patients called"],
  ["connected", "Connected"],
  ["pending", "Pending callbacks"],
  ["opd_done", "OPD Done"],
  ["ipd_done", "IPD Done"],
] as const;
export function DailyReportTable({
  rows,
  day,
}: {
  rows: AgentDailyRow[];
  day: string;
}) {
  function download() {
    const cell = (value: unknown) =>
      '"' +
      String(value)
        .replace(/^[=+@-]/, "'$&")
        .replace(/"/g, '""') +
      '"';
    const text = [
      ["Agent", ...columns.map(([, label]) => label)],
      ...rows.map((row) => [row.name, ...columns.map(([key]) => row[key])]),
    ]
      .map((row) => row.map(cell).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(
        new Blob([text], { type: "text/csv;charset=utf-8" }),
      ),
      a = document.createElement("a");
    a.href = url;
    a.download = `daily-team-report-${day}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="space-y-3">
      <Button variant="outline" onClick={download}>
        Download daily report
      </Button>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b bg-slate-50">
              <th className="p-3 text-left">Agent</th>
              {columns.map(([key, label]) => (
                <th key={key} className="p-3 text-right">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b">
                <td className="p-3 font-medium">
                  {row.name}
                  <span className="ml-2 text-xs text-slate-400">
                    {row.role}
                  </span>
                </td>
                {columns.map(([key]) => (
                  <td key={key} className="p-3 text-right tabular-nums">
                    {Number(row[key]).toLocaleString()}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        Pending callbacks show currently assigned callbacks due by the selected
        date. Older assignments without recorded timestamps and older
        unstructured call outcomes are not guessed.
      </p>
    </div>
  );
}
