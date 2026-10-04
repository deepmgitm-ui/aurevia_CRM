// Aurevia CRM — the lead list every analysis tab ends with.
//
// The tabs (Consultations, Surgeries, Agents, Marketing, Reports) all answer
// "how many?", which is useless on its own: the next question is always "WHICH
// patients?". This renders that second table — one row per lead, with the name
// opening the shared lead drawer, exactly like the Overview dashboard does —
// so a number on any tab is one tap away from the record behind it.
import { LeadOpenButton } from "../lead-open-button";
import { StatTable, type StatTableColumn, type StatTableRow } from "./stat-table";
import type { AnalyticsLead } from "./analytics";

const LEAD_COLUMNS: StatTableColumn[] = [
  { key: "name", label: "Patient" },
  { key: "city", label: "City" },
  { key: "treatment", label: "Treatment" },
  { key: "source", label: "Source" },
  { key: "agent", label: "Assigned To" },
  { key: "status", label: "Status" },
  { key: "date", label: "Lead Date" },
];

function toRows(rows: AnalyticsLead[]): StatTableRow[] {
  return rows.map((row) => ({
    key: row.id,
    cells: {
      name: (
        <LeadOpenButton
          leadId={row.id}
          title={`${row.treatment || row.disease} · ${row.city}`}
          label={row.name || "—"}
          className="font-medium text-slate-900 hover:underline"
        />
      ),
      city: row.city,
      treatment: row.treatment || row.disease,
      source: row.source,
      agent: row.assigned_to,
      status: row.status,
      date: row.lead_date,
    },
  }));
}

export function LeadListTable({
  rows,
  limit = 50,
  emptyMessage = "No leads in this date range.",
}: {
  rows: AnalyticsLead[];
  /** How many rows to render; the count in the card heading is the real total. */
  limit?: number;
  emptyMessage?: string;
}) {
  return (
    <StatTable
      columns={LEAD_COLUMNS}
      rows={toRows(rows.slice(0, limit))}
      emptyMessage={emptyMessage}
    />
  );
}
