import { CalendarCheck } from "lucide-react";

import { getMonthDays } from "./actions";
import { PlanCalendar } from "./plan-calendar";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const monthParam = Array.isArray(params.month) ? params.month[0] : params.month;

  const result = await getMonthDays(monthParam ?? undefined);
  if (!result.success) throw new Error(result.error);

  const todayIso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
  }).format(new Date());

/** "05 Oct" — the clinic reads dates this way, not as an ISO string. */
function formatShortDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Date(year, month - 1, day).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  });
}

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
          OPD &amp; IPD Schedule
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Every OPD booking, completed OPD and IPD surgery, on the day it happens. Dates are
          entered from the Leads page by picking a status.
        </p>
      </div>
      {result.data.upcoming.length > 0 && (
        // The "what is coming" list. It reads the SAME appointment data as the
        // grid below, so it can never disagree with the calendar about who is
        // coming on which day.
        <section aria-label="Upcoming appointments" className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <CalendarCheck className="size-4 text-indigo-600" aria-hidden="true" />
            Upcoming Appointments
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
              {result.data.upcoming.length}
            </span>
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {result.data.upcoming.slice(0, 12).map((item) => (
              <li
                key={`${item.leadId}-${item.kind}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{item.leadName}</p>
                  <p className="truncate text-xs text-slate-500">
                    <span
                      className={`font-medium ${
                        item.kind === "ipdDone"
                          ? "text-violet-700"
                          : item.kind === "opdDone"
                            ? "text-emerald-700"
                            : "text-blue-700"
                      }`}
                    >
                      {item.kindLabel}
                    </span>
                    {item.agent !== "-" && ` · ${item.agent}`}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 tabular-nums">
                  {formatShortDate(item.date)}
                </span>
              </li>
            ))}
          </ul>
          {result.data.upcoming.length > 12 && (
            <p className="text-xs text-slate-500">
              Showing the next 12 of {result.data.upcoming.length} appointments. Use the calendar
              below to see the rest of this month.
            </p>
          )}
        </section>
      )}
      <PlanCalendar
        days={result.data.days}
        month={result.data.month}
        todayIso={todayIso}
        warning={result.data.warning}
      />
    </div>
  );
}
