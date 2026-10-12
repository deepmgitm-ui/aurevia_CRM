import { getViewer } from "@/app/actions/leads";
import { getAgentDailyReport } from "@/app/actions/crm-workflows";
import { clinicDate } from "@/lib/attendance";
import { isWorkDate } from "@/lib/daily-work";
import { DailyReportTable } from "./report-table";
export default async function DailyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  const viewer = await getViewer();
  if (!viewer.success || !viewer.data || viewer.data.role === "employee")
    return (
      <p className="p-6">
        Daily team reports are available to admins and managers.
      </p>
    );
  const params = await searchParams,
    day = isWorkDate(params.day ?? "") ? params.day! : clinicDate(),
    result = await getAgentDailyReport(day);
  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Daily Team Report</h1>
        <p className="mt-2 text-sm text-slate-500">
          Assignments follow their recorded history. Calls are credited to the
          person who saved them; OPD/IPD completions to the person who recorded
          completion.
        </p>
      </div>
      <form className="flex items-end gap-2">
        <label className="text-sm">
          Report date (IST)
          <input
            className="mt-1 block rounded-lg border p-2"
            name="day"
            type="date"
            defaultValue={day}
            required
          />
        </label>
        <button className="rounded-lg bg-blue-600 px-4 py-2 text-white">
          View report
        </button>
      </form>
      {result.success ? (
        <DailyReportTable rows={result.data} day={day} />
      ) : (
        <p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">
          {result.error}
        </p>
      )}
    </div>
  );
}
