import { notFound } from "next/navigation";

import { getMyAttendance, getTeamAttendance } from "@/app/actions/attendance";
import { getEmployeeDirectory, getViewer } from "@/app/actions/leads";
import { clinicDate } from "@/lib/attendance";

import { AttendanceBoard } from "./attendance-board";

/**
 * /dashboard/attendance — the attendance register as its own month calendar.
 *
 * Admins/managers get the editable team register; employees get only their own
 * read-only calendar. The underlying queries and write actions enforce the
 * same role boundaries on the server.
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
  if (!viewer) notFound();
  const canManage = viewer?.role === "admin" || viewer?.role === "manager";

  const [attendanceResult, directoryResult] = await Promise.all([
    canManage ? getTeamAttendance(month) : getMyAttendance(month),
    canManage ? getEmployeeDirectory() : Promise.resolve(null),
  ]);
  const rows = attendanceResult.success ? attendanceResult.data.rows : [];
  const employees =
    directoryResult?.success
      ? directoryResult.data.map((person) => ({
          id: person.id,
          name: person.name,
          role: person.role,
          phone: person.phone,
          photo_url: person.photo_url,
        }))
      : [];
  const resultError = attendanceResult.success ? undefined : attendanceResult.error;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
          {canManage ? "Attendance" : "My Attendance"}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {canManage
            ? "Attendance is recorded automatically when employees sign in. Select an employee to view their calendar."
            : "Your attendance is recorded automatically when you sign in. This calendar is read-only."}
        </p>
      </div>

      <AttendanceBoard
        rows={rows}
        month={month}
        todayIso={clinicDate()}
        canManage={canManage}
        employees={employees}
        viewerEmployeeId={canManage ? null : viewer.id}
        viewerEmployeeName={canManage ? null : viewer.name}
      />

      {resultError && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {resultError}
        </p>
      )}
    </div>
  );
}
