// Aurevia CRM — monthly OPD/IPD appointment calendar.
//
// Admins can add and edit patient appointments directly from the calendar.
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
import { getMonthDays, type CalendarDay, type CalendarAppointment } from "./actions";
import { buildMonthCells, ensureArray } from "./month-grid";
import { AppointmentStatusActions } from "./appointment-status-actions";
import { AppointmentEditor } from "./appointment-editor";
import { PhonePreview } from "../phone-preview";
import { appointmentCategory } from "@/lib/appointments";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function ReminderIcon({ reminder }: { reminder: CalendarAppointment }) {
  const category = appointmentCategory(reminder.kind, reminder.appointmentStatus);
  const color = { opdBooked: "text-sky-700", opdDone: "text-blue-700", ipdBooked: "text-amber-700", ipdDone: "text-violet-700" }[category];
  const className = `size-4 ${color}`;
  if (category.startsWith("ipd")) return <Stethoscope className={className} aria-hidden="true" />;
  if (category === "opdDone") return <CircleCheck className={className} aria-hidden="true" />;
  return <CalendarDays className={className} aria-hidden="true" />;
}

/**
 * Appointment badge.
 *
 * Past dates stay MUTED, not red. A completed OPD or a finished surgery is
 * history, not a missed call â€” colouring it red would train the team to
 * ignore the colour that a genuine problem actually uses.
 */
function ReminderDot({ reminder }: { reminder: CalendarAppointment }) {
  const className = "size-2.5";
  const category = appointmentCategory(reminder.kind, reminder.appointmentStatus);
  const color = {
    opdBooked: reminder.past ? "bg-sky-300" : "bg-sky-600",
    opdDone: reminder.past ? "bg-blue-300" : "bg-blue-600",
    ipdBooked: reminder.past ? "bg-amber-300" : "bg-amber-600",
    ipdDone: reminder.past ? "bg-violet-300" : "bg-violet-600",
  }[category];
  const dotClass = `flex size-4 items-center justify-center rounded-full text-white ${color} ${reminder.dateSource !== "appointment" ? "ring-2 ring-amber-400 ring-offset-1" : ""}`;
  return (
    <span className={dotClass}>
      {category.startsWith("ipd") ? (
        <Stethoscope className={className} />
      ) : category === "opdDone" ? (
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
  canEdit = false,
  agents = [],
  selectedDate,
}: {
  /** Every rendered day cell (42 Monday-first cells from the server). */
  days: CalendarDay[];
  /** The month the server already loaded (yyyy-mm) — the starting cursor. */
  month: string;
  /** Today as yyyy-mm-dd in the clinic timezone. */
  todayIso: string;
  /** Database migration needed to show appointment dates, if any. */
  warning?: string;
  canEdit?: boolean;
  agents?: string[];
  selectedDate?: string;
}) {
  const [monthCursor, setMonthCursor] = useState(() => month || todayIso.slice(0, 7));
  const [selectedIso, setSelectedIso] = useState(selectedDate || (month === todayIso.slice(0, 7) ? todayIso : `${month}-01`));
  // Month-key cache: `days` always belongs to `monthKey`, so "fetching another
  // month" is a DERIVED flag â€” no setState needed inside the fetch effect.
  const [itemsFor, setItemsFor] = useState<{ monthKey: string; days: CalendarDay[] }>(() => ({
    monthKey: month || todayIso.slice(0, 7),
    days: days.map((day) => ({ ...day, reminders: ensureArray(day.reminders) })),
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
      setItemsFor({
        monthKey: monthCursor,
        days: response.data.days.map((day) => ({
          ...day,
          reminders: ensureArray(day.reminders),
        })),
      });
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
      return buildMonthCells(monthCursor).map((day) => ({
        ...day,
        reminders: ensureArray<CalendarAppointment>([]),
      }));
    }
    return itemsFor.days.map((day) => ({ ...day, reminders: ensureArray(day.reminders) }));
  }, [itemsFor.days, monthNeedsFetch, monthCursor]);

  const selected = visibleDays.find((day) => day.iso === selectedIso);
  const [cursorYear, cursorMonth] = monthCursor.split("-").map(Number);
  const monthLabel = new Date(cursorYear, cursorMonth - 1, 1).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
  const monthAppointments = visibleDays
    .filter((day) => day.iso.startsWith(`${monthCursor}-`))
    .flatMap((day) => day.reminders)
    .filter((item) => !["cancelled", "no_show"].includes(item.appointmentStatus))
    .map((item) => ({ item, category: appointmentCategory(item.kind, item.appointmentStatus) }))
    .sort((a, b) => a.item.date.localeCompare(b.item.date) || a.item.leadName.localeCompare(b.item.leadName));

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
                  Loading appointments…
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
              const dayReminders = ensureArray(day.reminders);
              const reminderSummary = dayReminders.slice(0, 3).map((reminder) =>
                `${reminder.leadName}${reminder.bookedBy ? `, updated by ${reminder.bookedBy}` : ""}`,
              ).join("; ");
              const undatedReminder = dayReminders.find((reminder) => reminder.dateSource !== "appointment");
              return (
                <button
                  key={day.iso}
                  type="button"
                  onClick={() => setSelectedIso(day.iso)}
                  title={day.iso}
                  aria-pressed={isSelected}
                  aria-label={`${day.iso}: ${dayReminders.length} calendar entries${reminderSummary ? `. ${reminderSummary}` : ""}`}
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
                    {dayReminders.slice(0, 3).map((reminder) => (
                      <ReminderDot
                        key={`${reminder.leadId}-${reminder.kind}`}
                        reminder={reminder}
                      />
                    ))}
                    {dayReminders.length > 3 && (
                      <span className="text-[10px] font-semibold text-slate-500">+{dayReminders.length - 3}</span>
                    )}
                  </span>
                  {undatedReminder && <span className="hidden max-w-full truncate text-[9px] leading-3 text-amber-900 md:block" title={`${undatedReminder.leadName} · ${undatedReminder.bookedBy ? `Updated by ${undatedReminder.bookedBy}` : undatedReminder.agent}`}>{undatedReminder.leadName} · {undatedReminder.bookedBy ? `Updated by ${undatedReminder.bookedBy}` : undatedReminder.agent}</span>}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium">
            <span className="text-sky-700">● OPD Booked</span><span className="text-blue-700">● OPD Done</span><span className="text-amber-700">● IPD Booked</span><span className="text-violet-700">● IPD Done</span><span className="text-slate-600">◉ Ring = date needed</span>
          </div>
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
            {canEdit && !loadingMonth && !calendarError && <AppointmentEditor agents={agents} defaultDate={selectedIso} label="Add appointment for this day" />}
            <section aria-label="Appointments" className="space-y-2">
              <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Appointments ({ensureArray(selected?.reminders).length})
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
                  Loading appointments…
                </p>
              ) : !calendarError && ensureArray(selected?.reminders).length === 0 && (
                <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  No OPD or IPD appointments on this day.
                </p>
              )}
              {ensureArray(selected?.reminders).map((reminder) => (
                <ReminderCard
                  key={`${reminder.leadId}-${reminder.kind}`}
                  reminder={reminder}
                  canEdit={canEdit}
                  agents={agents}
                  todayIso={todayIso}
                />
              ))}
            </section>

          </CardContent>
          </Card>
        </div>

      </div>
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3"><CardTitle className="text-base">OPD / IPD booked and done · {monthLabel}</CardTitle></CardHeader>
        <CardContent>
          {loadingMonth ? <p role="status" className="rounded-lg bg-slate-50 px-3 py-4 text-sm text-slate-500">Loading this month’s appointments…</p> : monthAppointments.length === 0 ? <p className="rounded-lg bg-slate-50 px-3 py-4 text-sm text-slate-500">No booked or done appointments this month.</p> : <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2 font-semibold">Date</th><th className="px-3 py-2 font-semibold">Type</th><th className="px-3 py-2 font-semibold">Patient</th><th className="px-3 py-2 font-semibold">Agent</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{monthAppointments.map(({ item, category }) => {
                const style = {
                  opdBooked: "bg-sky-50 text-sky-800 ring-sky-200",
                  opdDone: "bg-blue-50 text-blue-800 ring-blue-200",
                  ipdBooked: "bg-amber-50 text-amber-800 ring-amber-200",
                  ipdDone: "bg-violet-50 text-violet-800 ring-violet-200",
                }[category];
                const label = { opdBooked: "OPD Booked", opdDone: "OPD Done", ipdBooked: "IPD Booked", ipdDone: "IPD Done" }[category];
                return <tr key={`${item.leadId}-${category}`}><td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{new Date(`${item.date}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })}{item.dateSource !== "appointment" && <span className="ml-1 text-xs text-amber-700">(status date)</span>}</td><td className="px-3 py-2.5"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${style}`}>{label}</span></td><td className="px-3 py-2.5"><a href={`/dashboard/leads?q=${encodeURIComponent(item.phone === "-" ? item.leadName : item.phone)}#lead-list`} className="font-medium text-slate-900 hover:text-blue-700">{item.leadName}</a></td><td className="px-3 py-2.5 text-slate-600">{item.agent === "-" ? "Unassigned" : item.agent}</td></tr>;
              })}</tbody>
            </table>
          </div>}
        </CardContent>
      </Card>
    </div>
  );
}

function ReminderCard({
  reminder,
  canEdit,
  agents,
  todayIso,
}: {
  reminder: CalendarAppointment;
  canEdit: boolean;
  agents: string[];
  todayIso: string;
}) {
  const dateNeeded = reminder.dateSource !== "appointment";
  const updatedAtLabel = new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(reminder.updatedAt));
  return (
    <article className={`rounded-xl border p-3 ${{ opdBooked: "border-sky-200 bg-sky-50/60", opdDone: "border-blue-200 bg-blue-50/60", ipdBooked: "border-amber-200 bg-amber-50/60", ipdDone: "border-violet-200 bg-violet-50/60" }[appointmentCategory(reminder.kind, reminder.appointmentStatus)]}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <ReminderIcon reminder={reminder} />
          {reminder.leadName}
        </p>
        {reminder.past && <Badge variant="secondary">Past</Badge>}
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
        <span>{reminder.kindLabel}{reminder.time ? ` · ${reminder.time} IST` : ""}</span>
        {reminder.leadStatus !== "-" && <span>· {reminder.leadStatus}</span>}
      </p>
      {dateNeeded && <p className="mt-1 text-xs text-slate-600">
        {reminder.dateSource === "status-change" ? "Status updated" : "Status recorded"}: {updatedAtLabel}
        {reminder.bookedBy ? ` · Updated by ${reminder.bookedBy}` : ""}
      </p>}
      <p className="mt-1 truncate text-xs text-slate-500">Agent: {reminder.agent === "-" ? "Unassigned" : reminder.agent}</p>
      {reminder.phone !== "-" && <div className="mt-2 flex flex-wrap items-center gap-2"><PhonePreview value={reminder.phone} className="text-xs text-slate-600" /><a href={`tel:${reminder.phone.replace(/[^+\d]/g, "")}`} className="inline-flex rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700">Call patient</a></div>}
      {reminder.appointmentId && <AppointmentStatusActions id={reminder.appointmentId} status={reminder.appointmentStatus}/>}
      {canEdit && <div className="mt-2"><AppointmentEditor agents={agents} defaultDate={dateNeeded ? todayIso : reminder.date} defaultKind={reminder.kind} leadId={reminder.leadId} appointmentId={reminder.appointmentId ?? undefined} updatedAt={reminder.updatedAt} status={reminder.appointmentStatus} time={reminder.time} notes={reminder.notes} label={dateNeeded ? "Set appointment date" : "Edit appointment"} /></div>}
    </article>
  );
}
