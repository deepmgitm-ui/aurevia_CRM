import { getLeads } from "@/app/actions/leads";

import { DashboardStats } from "../dashboard-stats";
import { LeadsTable } from "../leads-table";

export default async function LeadsPage() {
  const leadsResult = await getLeads();
  const leads = leadsResult.success ? leadsResult.data : [];

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
          All Leads
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Review and manage every lead in your pipeline.
        </p>
      </div>
      <DashboardStats leads={leads} />
      <LeadsTable leads={leads} />
    </div>
  );
}
