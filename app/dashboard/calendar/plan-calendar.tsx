// Aurevia CRM — "Plan your calendar": month view mixing lead follow-up / call
// reminders (read from each lead's `follow_up_date`) with the signed-in user's
// own personal events (stored in the `calendar_events` table, one row each).
//
// RULES (short version, full version in ./actions.ts):
//   - leads.* is NEVER written here except `follow_up_date` itself.
//   - Calendar rows always belong to one auth user (owner_id); nobody ever sees
//     another person's personal events.
//   - Admins/managers see the whole team's reminder dots; employees see only
//     their own leads + their own personal events.
//   - A day cell shows at most 3 dots per lane (reminders / personal) + "+N".
"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  BadgeCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  History,
  MessageSquareText,
  NotebookPen,
  PhoneCall,
  Plus,
  Search,
  Sparkles,
  Stethoscope,
  Trash2,
  UserRound,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { updateLeadFollowUpDate } from "@/app/actions/leads";
import {
  clearFollowUp,
  createPersonalEvent,
  deletePersonalEvent,
  getMonthDays,
  markFollowUpDone,
  postponeFollowUp,
  searchLeadsForCalendar,
  updatePersonalEvent,
  type CalendarDay,
  type CalendarReminder,
  type FollowUpKind,
  type LeadSearchResult,
  type PersonalEvent,
} from "./actions";
import { LeadTimelineDialog } from "./lead-timeline-dialog";
import { toLocalIso } from "./month-grid";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PERSONAL_KINDS = ["note", "call", "visit", "leave"] as const;

function ReminderIcon({ kind }: { kind: FollowUpKind }) {
  const className = "size-4 text-blue-600";
  if (kind === "dnp") return <PhoneCall className={className} aria-hidden="true" />;
  if (kind === "consultation") return <Stethoscope className={className} aria-hidden="true" />;
  return <CalendarDays className={className} aria-hidden="true" />;
}

function ReminderDot({ kind, overdue }: { kind: FollowUpKind; overdue: boolean }) {
  const className = "size-2.5";
  const dotClass = `flex size-4 items-center justify-center rounded-full text-white ${
    overdue ? "bg-rose-600" : "bg-blue-600"
  }`;
  return (
    <span className={dotClass}>
      {kind === "dnp" ? (
        <PhoneCall className={className} />
      ) : kind === "consultation" ? (
        <Stethoscope className={className} />
      ) : (
        <BadgeCheck className={className} />
      )}
    </span>
  );
}

function eventDotClass(kind: PersonalEvent["kind"]) {
  if (kind === "leave") return "bg-violet-500";
  if (kind === "visit") return "bg-teal-500";
  if (kind === "call") return "bg-amber-500";
  return "bg-sky-500";
}


export function PlanCalendar({
  days,
  month,
  isTeamView,
  todayIso,
}: {
  /** Every rendered day cell (42 Monday-first cells from the server). */
  days: CalendarDay[];
  /** The month the server already loaded (yyyy-mm) — the starting cursor. */
  month: string;
  /** True for admins/managers: reminder chips show the owning agent. */
  isTeamView: boolean;
  /** Today's yyyy-mm-dd in the viewer's locale. */
  todayIso: string;
}) {
  const [monthCursor, setMonthCursor] = useState(() => month || todayIso.slice(0, 7));
  const [selectedIso, setSelectedIso] = useState(todayIso);
  // Month-key cache: `days` always belongs to `monthKey`, so "fetching another
  // month" is a DERIVED flag — no setState needed inside the fetch effect.
  const [itemsFor, setItemsFor] = useState<{ monthKey: string; days: CalendarDay[] }>(() => ({
    monthKey: month || todayIso.slice(0, 7),
    days,
  }));
  const [composerOpen, setComposerOpen] = useState(false);
  const [editing, setEditing] = useState<PersonalEvent | null>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<string>("note");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [timelineLeadId, setTimelineLeadId] = useState<string | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [leadQuery, setLeadQuery] = useState("");
  const [leadSearch, setLeadSearch] = useState<{ query: string; results: LeadSearchResult[] } | null>(null);
  const [pickedLead, setPickedLead] = useState<LeadSearchResult | null>(null);

  const loadingMonth = monthCursor !== itemsFor.monthKey;
  const trimmedLeadQuery = leadQuery.trim();
  const leadSearching = trimmedLeadQuery.length >= 2 && leadSearch?.query !== trimmedLeadQuery;
  const leadResults = leadSearch?.query === trimmedLeadQuery ? leadSearch.results : [];

  // Fetch a month the cache does not hold yet (arrow navigation) so every
  // month — not just the current one — shows its full timeline lanes.
  useEffect(() => {
    if (monthCursor === itemsFor.monthKey) return;
    let active = true;
    void getMonthDays(monthCursor).then((response) => {
      if (!active || !response.success || !response.data) return;
      setItemsFor({ monthKey: monthCursor, days: response.data.days });
    });
    return () => {
      active = false;
    };
  }, [monthCursor, itemsFor.monthKey]);

  // Debounced composer search. All state updates happen inside the timer /
  // promise callbacks, keeping the effect body itself render-neutral.
  useEffect(() => {
    if (!composerOpen) return;
    const q = leadQuery.trim();
    if (q.length < 2) return;
    let active = true;
    const handle = setTimeout(() => {
      void searchLeadsForCalendar(q).then((response) => {
        if (!active) return;
        setLeadSearch({ query: q, results: response.success ? (response.data ?? []) : [] });
      });
    }, 250);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [leadQuery, composerOpen]);

  const visibleDays = useMemo(() => {
    const [year, month] = monthCursor.split("-").map(Number);
    return itemsFor.days.filter((day) => {
      const [dayYear, dayMonth] = day.iso.split("-").map(Number);
      return dayYear === year && dayMonth === month;
    });
  }, [itemsFor.days, monthCursor]);

  const selected = itemsFor.days.find((day) => day.iso === selectedIso);
  const [cursorYear, cursorMonth] = monthCursor.split("-").map(Number);
  const monthLabel = new Date(cursorYear, cursorMonth - 1, 1).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });

  function shiftMonth(delta: number) {
    const next = new Date(cursorYear, cursorMonth - 1 + delta, 1);
    const nextCursor = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
    setMonthCursor(nextCursor);
    setSelectedIso(nextCursor === todayIso.slice(0, 7) ? todayIso : `${nextCursor}-01`);
  }

  function openTimeline(leadId: string) {
    setTimelineLeadId(leadId);
    setTimelineOpen(true);
  }

  function startComposer(existing: PersonalEvent | null, iso: string) {
    setEditing(existing);
    setTitle(existing?.title ?? "");
    setKind(existing?.kind ?? "note");
    setNotes(existing?.notes ?? "");
    setSelectedIso(iso);
    setPickedLead(null);
    setLeadQuery("");
    setLeadSearch(null);
    setComposerOpen(true);
  }

  async function handleSavePersonal() {
    // When a lead is picked, the composer schedules a follow-up instead of
    // writing a personal event — this is how you plan follow-ups from the grid.
    if (pickedLead && !editing) {
      setSaving(true);
      const response = await updateLeadFollowUpDate(pickedLead.leadId, selectedIso);
      setSaving(false);
      if (!response.success) {
        toast.add({ title: "Could not set the follow-up", description: response.error, type: "error" });
        return;
      }
      moveReminderTo(selectedIso, {
        leadId: pickedLead.leadId,
        leadName: pickedLead.leadName,
        phone: pickedLead.phone,
        leadStatus: pickedLead.status,
        date: selectedIso,
        overdue: selectedIso < todayIso,
        kind: "followup",
        agent: pickedLead.agent,
      });
      setComposerOpen(false);
      setPickedLead(null);
      setLeadQuery("");
      toast.add({ title: `${pickedLead.leadName} ka follow-up ${selectedIso} par set ho gaya` });
      return;
    }
    if (!title.trim()) {
      toast.add({ title: "Title missing", description: "Event ko ek naam do.", type: "error" });
      return;
    }
    setSaving(true);
    const response = editing
      ? await updatePersonalEvent(editing.id, { title: title.trim(), kind, notes: notes.trim() })
      : await createPersonalEvent({ date: selectedIso, title: title.trim(), kind, notes: notes.trim() });
    setSaving(false);
    if (!response.success) {
      toast.add({ title: "Could not save", description: response.error, type: "error" });
      return;
    }
    const saved = response.data;
    patchDays((current) =>
      current.map((day) => {
        if (day.iso !== saved.date) {
          return editing && day.iso === editing.date
            ? { ...day, personal: day.personal.filter((event) => event.id !== editing.id) }
            : day;
        }
        const personal = editing
          ? day.personal.map((event) => (event.id === editing.id ? saved : event))
          : [...day.personal, saved].sort((a, b) => a.title.localeCompare(b.title));
        return { ...day, personal };
      }),
    );
    setComposerOpen(false);
    toast.add({ title: editing ? "Event update ho gaya" : "Event add ho gaya" });
  }

  async function handleDeletePersonal(event: PersonalEvent) {
    setBusyId(`event-${event.id}`);
    const response = await deletePersonalEvent(event.id);
    setBusyId(null);
    if (!response.success) {
      toast.add({ title: "Could not delete", description: response.error, type: "error" });
      return;
    }
    patchDays((current) =>
      current.map((day) =>
        day.iso === event.date
          ? { ...day, personal: day.personal.filter((item) => item.id !== event.id) }
          : day,
      ),
    );
    toast.add({ title: "Event hata diya" });
  }

  function patchDays(updater: (days: CalendarDay[]) => CalendarDay[]) {
    setItemsFor((current) => ({ ...current, days: updater(current.days) }));
  }

  function patchReminderDay(date: string, updater: (reminders: CalendarReminder[]) => CalendarReminder[]) {
    patchDays((current) =>
      current.map((day) => (day.iso === date ? { ...day, reminders: updater(day.reminders) } : day)),
    );
  }

  /**
   * A lead has exactly ONE follow-up date, so re-scheduling must pull the chip
   * off every other day of the loaded month before dropping it on the new date.
   */
  function moveReminderTo(date: string, reminder: CalendarReminder) {
    patchDays((current) =>
      current.map((day) => {
        const others = day.reminders.filter((item) => item.leadId !== reminder.leadId);
        if (day.iso === date) return { ...day, reminders: [...others, reminder] };
        return others.length === day.reminders.length ? day : { ...day, reminders: others };
      }),
    );
  }

  /** Tomorrow, as yyyy-mm-dd — mirrors the server's postpone behaviour. */
  function tomorrowIso(iso: string): string {
    const [year, month, day] = iso.split("-").map(Number);
    return toLocalIso(new Date(year, month - 1, day + 1));
  }

  async function handleFollowUp(reminder: CalendarReminder, action: "done" | "postpone" | "clear") {
    setBusyId(`reminder-${reminder.leadId}-${reminder.date}`);
    const response =
      action === "done"
        ? await markFollowUpDone(reminder.leadId)
        : action === "postpone"
          ? await postponeFollowUp(reminder.leadId, reminder.date)
          : await clearFollowUp(reminder.leadId);
    setBusyId(null);
    if (!response.success) {
      toast.add({ title: "Could not update", description: response.error, type: "error" });
      return;
    }
    if (action === "postpone") {
      // The server pushes the follow-up to tomorrow — move the chip with it.
      const nextIso = tomorrowIso(reminder.date);
      moveReminderTo(nextIso, { ...reminder, date: nextIso, overdue: nextIso < todayIso });
    } else {
      patchReminderDay(reminder.date, (reminders) =>
        reminders.filter((item) => item.leadId !== reminder.leadId),
      );
    }
    toast.add({
      title:
        action === "done"
          ? "Follow-up done ✓"
          : action === "postpone"
            ? "Kal ke liye postpone ho gaya"
            : "Follow-up clear ho gaya",
    });
  }


  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card className="border-0 shadow-sm">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-lg">
            {monthLabel}
            {loadingMonth && <span className="ml-2 text-xs font-normal text-slate-400">loading…</span>}
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="icon" aria-label="Previous month" onClick={() => shiftMonth(-1)}>
              <ChevronLeft aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setMonthCursor(todayIso.slice(0, 7));
                setSelectedIso(todayIso);
              }}
            >
              Today
            </Button>
            <Button type="button" variant="ghost" size="icon" aria-label="Next month" onClick={() => shiftMonth(1)}>
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
          <div className="grid grid-cols-7 gap-1">
            {visibleDays.map((day) => {
              const isSelected = day.iso === selectedIso;
              const isToday = day.iso === todayIso;
              return (
                <button
                  key={day.iso}
                  type="button"
                  onClick={() => setSelectedIso(day.iso)}
                  onDoubleClick={() => startComposer(null, day.iso)}
                  title={`${day.iso} — double-click to add a personal event`}
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
                        overdue={reminder.overdue}
                      />
                    ))}
                    {day.reminders.length > 3 && (
                      <span className="text-[10px] font-semibold text-slate-500">+{day.reminders.length - 3}</span>
                    )}
                  </span>
                  <span className="flex flex-wrap items-center gap-1" aria-hidden="true">
                    {day.personal.slice(0, 3).map((event) => (
                      <span key={event.id} className={`size-2.5 rounded-full ${eventDotClass(event.kind)}`} />
                    ))}
                    {day.personal.length > 3 && (
                      <span className="text-[10px] font-semibold text-slate-500">+{day.personal.length - 3}</span>
                    )}
                  </span>
                  <span className="flex flex-wrap items-center gap-1" aria-hidden="true">
                    {day.created.slice(0, 2).map((lead) => (
                      <span
                        key={lead.leadId}
                        className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1 text-[9px] font-semibold text-emerald-700"
                      >
                        <Sparkles className="size-2.5" /> new
                      </span>
                    ))}
                    {day.created.length > 2 && (
                      <span className="text-[10px] font-semibold text-emerald-600">+{day.created.length - 2}</span>
                    )}
                    {day.activities.slice(0, 3).map((activity) => (
                      <span key={activity.id} className="size-1.5 rounded-full bg-slate-400" />
                    ))}
                    {day.activities.length > 3 && (
                      <span className="text-[10px] font-semibold text-slate-500">+{day.activities.length - 3}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Blue dot = lead follow-up or call, other colours = your personal events, <span className="font-semibold text-emerald-700">green</span> = a lead was created that day, grey dot = activity (note, status or call). Double-click a day to add a personal event, or use Follow-up on a selected day to schedule a lead&apos;s follow-up.
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
            <div className="flex items-center gap-1.5">
              <Button type="button" size="sm" variant="outline" onClick={() => startComposer(null, selectedIso)}>
                <CalendarDays aria-hidden="true" /> Follow-up
              </Button>
              <Button type="button" size="sm" onClick={() => startComposer(null, selectedIso)}>
                <Plus aria-hidden="true" /> Event
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <section aria-label="Follow-ups" className="space-y-2">
              <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Follow-ups ({selected?.reminders.length ?? 0})
              </h3>
              {(selected?.reminders.length ?? 0) === 0 && (
                <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  No follow-up or call reminders on this day.
                </p>
              )}
              {selected?.reminders.map((reminder) => (
                <ReminderCard
                  key={`${reminder.leadId}-${reminder.kind}`}
                  reminder={reminder}
                  isTeamView={isTeamView}
                  busy={busyId === `reminder-${reminder.leadId}-${reminder.date}`}
                  onAction={(action) => void handleFollowUp(reminder, action)}
                />
              ))}
            </section>

            <section aria-label="New leads" className="space-y-2">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                <Sparkles className="size-3.5 text-emerald-600" aria-hidden="true" /> Naye leads (
                {selected?.created.length ?? 0})
              </h3>
              {(selected?.created.length ?? 0) === 0 && (
                <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">No new leads were added on this day.</p>
              )}
              {selected?.created.map((lead) => (
                <LeadChipButton
                  key={lead.leadId}
                  name={lead.leadName}
                  meta={[lead.status, isTeamView && lead.agent !== "-" ? lead.agent : null].filter(Boolean).join(" · ")}
                  icon={<Sparkles className="size-3.5 text-emerald-600" aria-hidden="true" />}
                  onClick={() => openTimeline(lead.leadId)}
                />
              ))}
            </section>

            <section aria-label="Timeline activity" className="space-y-2">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                <History className="size-3.5" aria-hidden="true" /> Activity ({selected?.activities.length ?? 0})
              </h3>
              {(selected?.activities.length ?? 0) === 0 && (
                <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  No notes, status changes or calls on this day.
                </p>
              )}
              {selected?.activities.map((activity) => (
                <LeadChipButton
                  key={activity.id}
                  name={activity.leadName}
                  meta={activity.description || activity.actionType}
                  icon={<MessageSquareText className="size-3.5 text-sky-600" aria-hidden="true" />}
                  onClick={() => openTimeline(activity.leadId)}
                />
              ))}
            </section>

            <section aria-label="Personal events" className="space-y-2">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                <NotebookPen className="size-3.5" aria-hidden="true" /> Tumhare events ({selected?.personal.length ?? 0})
              </h3>
              {(selected?.personal.length ?? 0) === 0 && (
                <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  No personal events — use Event to add leave, a visit or a note.
                </p>
              )}
              {selected?.personal.map((event) => (
                <PersonalCard
                  key={event.id}
                  event={event}
                  busy={busyId === `event-${event.id}`}
                  onEdit={() => startComposer(event, event.date)}
                  onDelete={() => void handleDeletePersonal(event)}
                />
              ))}
            </section>
          </CardContent>
        </Card>
      </div>

      <Dialog open={composerOpen} onOpenChange={setComposerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit event" : `${selectedIso} — naya event`}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {!editing && (
              <div className="space-y-1">
                <Label htmlFor="plan-lead-search">Schedule a follow-up for a lead (optional)</Label>
                {pickedLead ? (
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-blue-300 bg-blue-50 px-3 py-2">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {pickedLead.leadName}{" "}
                      <span className="font-normal text-slate-500">· {pickedLead.phone}</span>
                    </p>
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      onClick={() => {
                        setPickedLead(null);
                        setLeadQuery("");
                        setLeadSearch(null);
                      }}
                    >
                      Change
                    </Button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 size-4 text-slate-400" aria-hidden="true" />
                    <Input
                      id="plan-lead-search"
                      value={leadQuery}
                      onChange={(event) => setLeadQuery(event.target.value)}
                      placeholder="Search by lead name or phone…"
                      className="pl-8"
                    />
                    {leadQuery.trim().length >= 2 && (
                      <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
                        {leadSearching && <p className="px-3 py-2 text-xs text-slate-500">Search…</p>}
                        {!leadSearching && leadResults.length === 0 && (
                          <p className="px-3 py-2 text-xs text-slate-500">No leads found.</p>
                        )}
                        {!leadSearching &&
                          leadResults.map((lead) => (
                            <button
                              key={lead.leadId}
                              type="button"
                              onClick={() => {
                                setPickedLead(lead);
                                setLeadSearch(null);
                              }}
                              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-blue-50"
                            >
                              <span className="font-medium text-slate-900">{lead.leadName}</span>
                              <span className="text-xs text-slate-500">
                                {lead.phone} · {lead.status}
                              </span>
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                )}
                <p className="text-[11px] text-slate-400">
                  Picking a lead turns {selectedIso} into that lead&apos;s follow-up — leave Title and Type blank.
                </p>
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="plan-event-title">Title</Label>
              <Input
                id="plan-event-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="jaise: Doctor visit, Chhutti, Call list"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="plan-event-kind">Type</Label>
              <Select value={kind} onValueChange={(value) => setKind(value ?? "note")}>
                <SelectTrigger id="plan-event-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERSONAL_KINDS.map((option) => (
                    <SelectItem key={option} value={option} className="capitalize">
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="plan-event-notes">Notes (optional)</Label>
              <Textarea
                id="plan-event-notes"
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="kuch yaad rakhne layak…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setComposerOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleSavePersonal()} disabled={saving}>
              {saving ? "Saving…" : pickedLead && !editing ? "Set follow-up" : editing ? "Save changes" : "Add event"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LeadTimelineDialog leadId={timelineLeadId} open={timelineOpen} onOpenChange={setTimelineOpen} />
    </div>
  );
}

/** Compact clickable row in the day panel that opens the lead's full timeline. */
function LeadChipButton({
  name,
  meta,
  icon,
  onClick,
}: {
  name: string;
  meta: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="View this lead's full timeline"
      className="flex w-full items-start gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/50"
    >
      <span className="mt-0.5">{icon}</span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-slate-900">{name}</span>
        <span className="block truncate text-xs text-slate-500">{meta}</span>
      </span>
    </button>
  );
}

function ReminderCard({
  reminder,
  isTeamView,
  busy,
  onAction,
}: {
  reminder: CalendarReminder;
  isTeamView: boolean;
  busy: boolean;
  onAction: (action: "done" | "postpone" | "clear") => void;
}) {
  return (
    <article className="rounded-xl border border-slate-200 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <ReminderIcon kind={reminder.kind} />
          {reminder.leadName}
        </p>
        {reminder.overdue && <Badge variant="destructive">Overdue</Badge>}
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
        <span className="capitalize">{reminder.kind === "dnp" ? "DNP — call back" : reminder.kind}</span>
        {reminder.leadStatus !== "-" && <span>· {reminder.leadStatus}</span>}
        {isTeamView && reminder.agent !== "-" && (
          <span className="inline-flex items-center gap-1">
            · <UserRound className="size-3" aria-hidden="true" /> {reminder.agent}
          </span>
        )}
      </p>
      {reminder.phone !== "-" && <p className="mt-1 text-xs font-medium text-slate-700">{reminder.phone}</p>}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button type="button" size="xs" disabled={busy} onClick={() => onAction("done")}>
          <CircleCheck aria-hidden="true" /> Done
        </Button>
        <Button type="button" size="xs" variant="outline" disabled={busy} onClick={() => onAction("postpone")}>
          Tomorrow
        </Button>
        <Button type="button" size="xs" variant="ghost" disabled={busy} onClick={() => onAction("clear")}>
          Clear
        </Button>
      </div>
    </article>
  );
}

function PersonalCard({
  event,
  busy,
  onEdit,
  onDelete,
}: {
  event: PersonalEvent;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="rounded-xl border border-slate-200 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <span className={`size-2.5 rounded-full ${eventDotClass(event.kind)}`} aria-hidden="true" />
          {event.title}
        </p>
        <Badge variant="secondary" className="capitalize">
          {event.kind}
        </Badge>
      </div>
      {event.notes && <p className="mt-1 text-xs text-slate-500">{event.notes}</p>}
      <div className="mt-2 flex gap-1.5">
        <Button type="button" size="xs" variant="outline" disabled={busy} onClick={onEdit}>
          Edit
        </Button>
        <Button type="button" size="xs" variant="ghost" disabled={busy} onClick={onDelete}>
          <Trash2 aria-hidden="true" /> Delete
        </Button>
      </div>
    </article>
  );
}