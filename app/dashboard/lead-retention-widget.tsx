import { AlertTriangle, Archive, Clock3, Download } from "lucide-react";

import { getLeadRetentionDashboardData } from "@/app/actions/lead-retention";

const clinicDateTime = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

export async function LeadRetentionWidget() {
  const { reminders, archives, error } = await getLeadRetentionDashboardData();
  if (!error && reminders.length === 0 && archives.length === 0) return null;

  return (
    <section aria-labelledby="lead-retention-title" className="rounded-2xl border border-amber-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-800">
            <AlertTriangle className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h2 id="lead-retention-title" className="font-semibold text-slate-950">Lead retention</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              Leads are archived and permanently removed two months after entry. This reminder appears during the final seven days.
            </p>
          </div>
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">{error}</p>
      ) : (
        <>
          {reminders.length > 0 && (
            <ul className="mt-4 divide-y divide-amber-100 rounded-xl border border-amber-100 bg-amber-50/50">
              {reminders.map((lead) => (
                <li key={lead.lead_id} className="flex flex-wrap items-center justify-between gap-3 p-3 sm:p-4">
                  <div className="min-w-0">
                    <p className="break-words font-medium text-slate-950">{lead.lead_name}</p>
                    <p className="mt-1 text-xs text-slate-600">
                      {lead.lead_phone || "No phone"} � {lead.lead_status} � {lead.assigned_to.trim() || "Unassigned"}
                    </p>
                  </div>
                  <p className="inline-flex items-center gap-1 text-xs font-medium text-amber-900">
                    <Clock3 className="size-3.5" aria-hidden="true" /> Removal {clinicDateTime.format(new Date(lead.expires_at))}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {archives.length > 0 && (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <Archive className="size-4 text-emerald-700" aria-hidden="true" /> Recent retention archives
              </h3>
              <ul className="mt-2 space-y-2">
                {archives.map((archive) => {
                  const names = archive.lead_rows.map((lead) => lead.name?.trim()).filter(Boolean);
                  const title = names.length === 1 ? names[0] : `${archive.lead_count.toLocaleString()} leads`;
                  return (
                    <li key={archive.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-800">{title}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {archive.activity_count.toLocaleString()} activity entries � {clinicDateTime.format(new Date(archive.deleted_at))}
                        </p>
                      </div>
                      <a
                        href={`/dashboard/retention-archives/${archive.id}`}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900 transition-colors hover:bg-emerald-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
                      >
                        <Download className="size-3.5" aria-hidden="true" /> Download JSON
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
