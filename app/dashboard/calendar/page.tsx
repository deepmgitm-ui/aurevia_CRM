import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";

import { getMonthDays, type PersonalEvent } from "./actions";
import { PlanCalendar } from "./plan-calendar";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const monthParam = Array.isArray(params.month) ? params.month[0] : params.month;

  // Auth gate: without a signed-in user there is no "my calendar".
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const result = await getMonthDays(monthParam ?? undefined);
  if (!result.success) throw new Error(result.error);

  const todayIso = new Date().toLocaleDateString("en-CA");
  const personal = result.data.days.flatMap((day) =>
    day.personal.map((event: PersonalEvent) => event),
  );
  const upcoming = personal
    .filter((event) => event.date >= todayIso)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(0, 5);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">Plan your calendar</h1>
        <p className="mt-2 text-sm text-slate-500">
          Lead follow-ups aur DNP callbacks apne aap aate hain, aur neeche Event dabakar apni chhutti / visit / note
          khud plan karo.
        </p>
      </div>
      {upcoming.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Aane wale personal events">
          {upcoming.map((event) => (
            <span
              key={event.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600"
            >
              <span className="font-semibold text-slate-900">{event.date.slice(8)}/{event.date.slice(5, 7)}</span>
              <span className="capitalize text-slate-400">{event.kind}</span> {event.title}
            </span>
          ))}
        </div>
      )}
      <PlanCalendar
        days={result.data.days}
        month={result.data.month}
        isTeamView={result.data.isTeamView}
        todayIso={todayIso}
      />
    </div>
  );
}