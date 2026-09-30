import { notFound } from "next/navigation";

import { getTeamAttendance } from "@/app/actions/attendance";
import { getEmployeeDirectory, getViewer } from "@/app/actions/leads";
import { clinicDate } from "@/lib/attendance";

import { AttendanceCalendar } from "./attendance-calendar";

/**
 * /dashboard/attendance — the attendance register as its own month calendar.
 *
 * Admin/manager only. The check lives here on the server (not just in the nav),
 * so an employee who types the URL gets a 404 rather than the roster. The
 * underlying queries are role-guarded too, so this is defence in depth rather
 * than the only lock.
 *
 * Attendance used to be a lane inside "My Calendar"; it was moved out because
 * that screen is a personal tool every employee opens, and this is a
 * management register.
 */
export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string | string[] }>;
}) {
  const params = await searchParams;
  const monthParam = Array.isArray(params.month) ? params.month[0] : params.month;
  const month =
    typeof monthParam === "string" && /^\d{4}-\d{2}$/.test(monthParam)
      ? monthParam
      : clinicDate().slice(0, 7);

  const viewerResult = await getViewer();
  const viewer = viewerResult.success ? viewerResult.data : null;
  const canManage = viewer?.role === "admin" || viewer?.role === "manager";
  if (!canManage) notFound();

  const result = await getTeamAttendance(month);
  const rows = result.success ? result.data.rows : [];
  const summary = result.success
    ? result.data.summary
    : { present: 0, absent: 0, halfDay: 0, total: 0 };

  // The roster drives the "add a mark for someone who never signed in" control.
  // getEmployeeDirectory is itself admin/manager-only and returns [] otherwise.
  const directoryResult = await getEmployeeDirectory();
  const employees = directoryResult.success
    ? directoryResult.data.map((person) => ({ id: person.id, name: person.name }))
    : [];

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
          Attendance
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Employee login karte hi check-in mark ho jata hai. Status change ya delete karne ke liye
          din ke andar us employee par dropdown use karo.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Total marks", value: summary.total, tone: "text-slate-900" },
          { label: "Present", value: summary.present, tone: "text-emerald-600" },
          { label: "Half-Day", value: summary.halfDay, tone: "text-amber-600" },
          { label: "Absent", value: summary.absent, tone: "text-rose-600" },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
              {card.label}
            </p>
            <p className={`mt-1 text-2xl font-semibold ${card.tone}`}>
              {card.value.toLocaleString("en-IN")}
            </p>
          </div>
        ))}
      </div>

      {!result.success && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {result.error}
        </p>
      )}

      <AttendanceCalendar
        rows={rows}
        month={month}
        todayIso={clinicDate()}
        canManage={canManage}
        employees={employees}
      />
    </div>
  );
}
