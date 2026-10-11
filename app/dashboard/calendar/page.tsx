import { getMonthDays } from "./actions";
import { PlanCalendar } from "./plan-calendar";
import { UpcomingAppointments } from "./upcoming-appointments";

export default async function CalendarPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const month = Array.isArray(params.month) ? params.month[0] : params.month;
  const result = await getMonthDays(month, true);
  if (!result.success) throw new Error(result.error);
  const todayIso = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">Upcoming Appointments</h1>
        <p className="mt-2 text-sm text-slate-500">Plan patient calls and arrivals with your OPD and IPD schedule.</p>
      </div>
      {!result.data.warning && <UpcomingAppointments items={result.data.upcoming} todayIso={todayIso} />}
      <PlanCalendar days={result.data.days} month={result.data.month} todayIso={todayIso} warning={result.data.warning} />
    </div>
  );
}
