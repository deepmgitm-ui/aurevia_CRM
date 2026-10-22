import { getMonthDays } from "./actions";
import { PlanCalendar } from "./plan-calendar";
import { UpcomingAppointments } from "./upcoming-appointments";
import { AppointmentEditor } from "./appointment-editor";
import { getCalendarEditorSetup } from "./entry-actions";
import { isWorkDate } from "@/lib/daily-work";
import { createHash } from "node:crypto";

export default async function CalendarPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const month = Array.isArray(params.month) ? params.month[0] : params.month;
  const [result, editor] = await Promise.all([getMonthDays(month, true), getCalendarEditorSetup()]);
  if (!result.success) throw new Error(result.error);
  const todayIso = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const date = Array.isArray(params.date) ? params.date[0] : params.date;
  const selectedDate = isWorkDate(date ?? "") && date?.slice(0, 7) === result.data.month ? date : undefined;
  // Fresh server data must replace the client's month cache after saving.
  const revision = createHash("sha256").update(JSON.stringify(result.data.days)).digest("hex");
  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">Upcoming Appointments</h1>
        <p className="mt-2 text-sm text-slate-500">Upcoming and past patient appointments, with your OPD and IPD calendar.</p>
        </div>
        {editor.canEdit && <AppointmentEditor agents={editor.agents} defaultDate={selectedDate ?? todayIso} />}
      </div>
      {!result.data.warning && <UpcomingAppointments key={`${revision}-${params.view}`} initialView={params.view === "past" ? "past" : "upcoming"} items={result.data.upcoming} pastItems={result.data.past} todayIso={todayIso} canEdit={editor.canEdit} showAttribution={editor.canEdit} agents={editor.agents} />}
      <PlanCalendar key={`${revision}-${selectedDate ?? ""}`} selectedDate={selectedDate} days={result.data.days} month={result.data.month} todayIso={todayIso} warning={result.data.warning} canEdit={editor.canEdit} agents={editor.agents} />
    </div>
  );
}
