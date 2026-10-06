// Aurevia CRM — monthly OPD/IPD appointment calendar.
//
// Appointment dates are read-only here and are set from the Leads page.
"use client";

import { useEffect, useMemo, useState } from "react";

import {
  BadgeCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Stethoscope,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMonthDays, type CalendarDay, type CalendarAppointment, type AppointmentKind } from "./actions";
import { buildMonthCells } from "./month-grid";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function ReminderIcon({ kind }: { kind: AppointmentKind }) {
  const className = "size-4 text-blue-600";
  if (kind === "ipdDone") return <Stethoscope className={className} aria-hidden="true" />;
  if (kind === "opdDone") return <CircleCheck className={className} aria-hidden="true" />;
  return <CalendarDays className={className} aria-hidden="true" />;
}

/**
 * Appointment badge.
 *
 * Past dates stay MUTED, not red. A completed OPD or a finished surgery is
 * history, not a missed call â€” colouring it red would train the team to
 * ignore the colour that a genuine problem actually uses.
 */
function ReminderDot({ kind, past }: { kind: AppointmentKind; past: boolean }) {
  const className = "size-2.5";
  const dotClass = `flex size-4 items-center justify-center rounded-full text-white ${
    kind === "ipdDone"
      ? past
        ? "bg-violet-300"
        : "bg-violet-600"
      : kind === "opdDone"
        ? past
          ? "bg-emerald-300"
          : "bg-emerald-600"
        : past
          ? "bg-blue-300"
          : "bg-blue-600"
  }`;
  return (
    <span className={dotClass}>
      {kind === "ipdDone" ? (
        <Stethoscope className={className} />
      ) : kind === "opdDone" ? (
        <CircleCheck className={className} />
      ) : (
        <BadgeCheck className={className} />
      )}
    </span>
  );
}

export function PlanCalendar({
  days,
  month,
  todayIso,
  warning,
}: {
  /** Every rendered day cell (42 Monday-first cells from the server). */
  days: CalendarDay[];
  /** The month the server already loaded (yyyy-mm) — the starting cursor. */
  month: string;
  /** Today as yyyy-mm-dd in the clinic timezone. */
  todayIso: string;
  /** Database migration needed to show appointment dates, if any. */
  warning?: string;
}) {
  const [monthCursor, setMonthCursor] = useState(() => month || todayIso.slice(0, 7));
  const [selectedIso, setSelectedIso] = useState(todayIso);
  // Month-key cache: `days` always belongs to `monthKey`, so "fetching another
  // month" is a DERIVED flag â€” no setState needed inside the fetch effect.
  const [itemsFor, setItemsFor] = useState<{ monthKey: string; days: CalendarDay[] }>(() => ({
    monthKey: month || todayIso.slice(0, 7),
    days,
  }));
  const [calendarError, setCalendarError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const monthNeedsFetch = monthCursor !== itemsFor.monthKey;
  const loadingMonth = monthNeedsFetch && !calendarError;

  // Fetch a month the cache does not hold yet (arrow navigation) so every
  // month â€” not just the current one â€” shows its appointments.
  useEffect(() => {
    if (monthCursor === itemsFor.monthKey) return;
    let active = true;
    void getMonthDays(monthCursor).then((response) => {
      if (!active) return;
      if (!response.success || !response.data) {
        setCalendarError(response.success ? "No calendar data was returned." : response.error);
        return;
      }
      setItemsFor({ monthKey: monthCursor, days: response.data.days });
    }).catch((error: unknown) => {
      if (!active) return;
      setCalendarError(
        error instanceof Error ? error.message : "Could not load appointments for this month.",
      );
    });
    return () => {
      active = false;
    };
  }, [monthCursor, itemsFor.monthKey, reloadToken]);

  const visibleDays = useMemo(() => {
    if (monthNeedsFetch) {
      return buildMonthCells(monthCursor).map((day) => ({ ...day, reminders: [] }));
    }
    const [year, month] = monthCursor.split("-").map(Number);
    return itemsFor.days.filter((day) => {
      const [dayYear, dayMonth] = day.iso.split("-").map(Number);
      return dayYear === year && dayMonth === month;
    });
  }, [itemsFor.days, monthNeedsFetch, monthCursor]);

  const selected = visibleDays.find((day) => day.iso === selectedIso);
  const [cursorYear, cursorMonth] = monthCursor.split("-").map(Number);
  const monthLabel = new Date(cursorYear, cursorMonth - 1, 1).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });

  function shiftMonth(delta: number) {
    const next = new Date(cursorYear, cursorMonth - 1 + delta, 1);
    const nextCursor = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
    setCalendarError("");
    setMonthCursor(nextCursor);
    setSelectedIso(nextCursor === todayIso.slice(0, 7) ? todayIso : `${nextCursor}-01`);
  }

  function retryMonth() {
    setCalendarError("");
    setReloadToken((current) => current + 1);
  }

  return (
    <div className="space-y-4">
      {warning ? (
        <p
          role="status"
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          {warning}
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="border-0 shadow-sm">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-lg">
              {monthLabel}
              {loadingMonth && (
                <span className="ml-2 text-xs font-normal text-slate-400" role="status">
                  Loading appointments...
                </span>
              )}
            </CardTitle>
            <div className="flex items-center gap-1">
              <Button type="button" variant="ghost" size="icon" aria-label="Previous month" disabled={loadingMonth} onClick={() => shiftMonth(-1)}>
                <ChevronLeft aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loadingMonth}
                onClick={() => {
                  const todayMonth = todayIso.slice(0, 7);
                  const shouldRetry = monthCursor === todayMonth && monthNeedsFetch;
                  setCalendarError("");
                  setMonthCursor(todayMonth);
                  setSelectedIso(todayIso);
                  if (shouldRetry) setReloadToken((current) => current + 1);
                }}
              >
                Today
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label="Next month" disabled={loadingMonth} onClick={() => shiftMonth(1)}>
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
            {WEEKDAY_LABELS.map((label) => (
              <div key={label} className="py-1">
                {label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1" aria-busy={loadingMonth}>
            {visibleDays.map((day) => {
              const isSelected = day.iso === selectedIso;
              const isToday = day.iso === todayIso;
              return (
                <button
                  key={day.iso}
                  type="button"
                  onClick={() => setSelectedIso(day.iso)}
                  title={day.iso}
                  className={`flex min-h-[74px] flex-col items-stretch gap-1 rounded-xl border p-1.5 text-left transition-colors sm:min-h-[86px] ${
                    isSelected
                      ? "border-blue-500 bg-blue-50/70"
                      : day.isCurrentMonth
                        ? "border-slate-200 bg-white hover:border-blue-300"
                        : "border-slate-100 bg-slate-50 text-slate-400"
                  }`}
                >
                  <span
                    className={`flex size-6 items-center justify-center rounded-full text-xs font-semibold ${
                      isToday ? "bg-blue-600 text-white" : ""
                    }`}
                  >
                    {day.day}
                  </span>
                  <span className="flex flex-wrap items-center gap-1" aria-hidden="true">
                    {day.reminders.slice(0, 3).map((reminder) => (
                      <ReminderDot
                        key={`${reminder.leadId}-${reminder.kind}`}
                        kind={reminder.kind}
                        past={reminder.past}
                      />
                    ))}
                    {day.reminders.length > 3 && (
                      <span className="text-[10px] font-semibold text-slate-500">+{day.reminders.length - 3}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            <span className="font-semibold text-blue-700">Blue</span> = OPD booked, <span className="font-semibold text-emerald-700">green</span> = OPD done, <span className="font-semibold text-violet-700">violet</span> = IPD / surgery.
          </p>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-0 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">
              {selected
                ? new Date(selected.iso + "T00:00:00").toLocaleDateString("en-IN", {
                    weekday: "long",
                    day: "numeric",
                    month: "short",
                  })
                : selectedIso}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <section aria-label="Appointments" className="space-y-2">
              <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Appointments ({selected?.reminders.length ?? 0})
              </h3>
              {calendarError && (
                <div>
                  <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                    {calendarError}
                  </p>
                  <Button type="button" variant="outline" size="sm" className="mt-2" onClick={retryMonth}>
                    Retry
                  </Button>
                </div>
              )}
              {loadingMonth ? (
                <p role="status" className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  Loading appointments...
                </p>
              ) : !calendarError && (selected?.reminders.length ?? 0) === 0 && (
                <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  No OPD or IPD appointments on this day.
                </p>
              )}
              {selected?.reminders.map((reminder) => (
                <ReminderCard
                  key={`${reminder.leadId}-${reminder.kind}`}
                  reminder={reminder}
                />
              ))}
            </section>

          </CardContent>
          </Card>
        </div>

      </div>
    </div>
  );
}

function ReminderCard({
  reminder,
}: {
  reminder: CalendarAppointment;
}) {
  return (
    <article className="rounded-xl border border-slate-200 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <ReminderIcon kind={reminder.kind} />
          {reminder.leadName}
        </p>
        {reminder.past && <Badge variant="secondary">Past</Badge>}
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
        <span>{reminder.kindLabel}</span>
        {reminder.leadStatus !== "-" && <span>· {reminder.leadStatus}</span>}
      </p>
      {reminder.phone !== "-" && <p className="mt-1 text-xs font-medium text-slate-700">{reminder.phone}</p>}
    </article>
  );
}
