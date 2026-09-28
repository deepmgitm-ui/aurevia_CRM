import * as React from "react";

// ---------------------------------------------------------------------------
// Small presentational helpers shared by the analysis pages
// (plain components — usable from both server and client components).
// ---------------------------------------------------------------------------

export interface StatTableColumn {
  key: string;
  label: string;
  align?: "left" | "right";
}

export interface StatTableRow {
  key: string;
  cells: Record<string, React.ReactNode>;
}

export function StatTable({
  columns,
  rows,
  emptyMessage = "No data for the selected range yet.",
}: {
  columns: StatTableColumn[];
  rows: StatTableRow[];
  emptyMessage?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-slate-50/80 text-left">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={`px-4 py-2.5 text-xs font-semibold tracking-wide text-slate-500 uppercase ${
                  column.align === "right" ? "text-right" : ""
                }`}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-8 text-center text-slate-500">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.key} className="border-t border-slate-100 hover:bg-slate-50/60">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-4 py-2.5 text-slate-700 ${column.align === "right" ? "text-right" : ""}`}
                  >
                    {row.cells[column.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function SectionCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
        </div>
        {action}
      </header>
      <div className="p-1 sm:p-2">{children}</div>
    </section>
  );
}

export function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <header>
      <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{title}</h1>
      <p className="mt-1 text-sm text-slate-500">{description}</p>
    </header>
  );
}
