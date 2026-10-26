"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarCheck, Phone, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppointmentStatusActions } from "./appointment-status-actions";
import { AppointmentEditor } from "./appointment-editor";
import { PhonePreview } from "../phone-preview";
import type { CalendarAppointment } from "./actions";

export function UpcomingAppointments({ items, pastItems, todayIso, canEdit, showAttribution, agents, initialView = "upcoming" }: { items: CalendarAppointment[]; pastItems: CalendarAppointment[]; todayIso: string; canEdit: boolean; showAttribution: boolean; agents: string[]; initialView?: "upcoming" | "past" }) {
  const [view, setView] = useState(initialView);
  const [period, setPeriod] = useState("all");
  const [kind, setKind] = useState("all");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(12);
  const weekEnd = new Date(todayIso + "T00:00:00Z");
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  const query = search.trim().toLowerCase();
  const yesterday = new Date(todayIso + "T00:00:00Z");
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const pastWeekStart = new Date(todayIso + "T00:00:00Z");
  pastWeekStart.setUTCDate(pastWeekStart.getUTCDate() - 7);
  const [appointmentStatus,setAppointmentStatus]=useState("all");
  const sourceItems = view === "past" ? pastItems : items;
  const filtered = sourceItems.filter((item) =>
    (appointmentStatus==="all" || item.appointmentStatus===appointmentStatus) &&
    (period !== "today" || item.date === (view === "past" ? yesterday.toISOString().slice(0, 10) : todayIso)) &&
    (period !== "week" || (view === "past" ? item.date >= pastWeekStart.toISOString().slice(0, 10) : item.date <= weekEnd.toISOString().slice(0, 10))) &&
    (kind === "all" || (kind === "ipd" ? item.kind === "ipdDone" : item.kind !== "ipdDone")) &&
    (!query || `${item.leadName} ${item.phone} ${item.agent}`.toLowerCase().includes(query)),
  );
  const todayItems = items.filter((item) => item.date === todayIso && !["cancelled","no_show"].includes(item.appointmentStatus));
  const todayOpdCount = new Set(todayItems.filter((item) => item.kind !== "ipdDone").map((item) => item.leadId)).size;
  const todayIpdCount = new Set(todayItems.filter((item) => item.kind === "ipdDone").map((item) => item.leadId)).size;
  return (
    <section aria-label={view === "past" ? "Past appointments" : "Upcoming appointments"} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-slate-50/60 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-semibold text-slate-900"><CalendarCheck aria-hidden="true" className="size-5 text-blue-600" />Patient schedule</h2>
          <p className="text-sm text-slate-600">Today: <strong>{todayOpdCount} OPD</strong> · <strong>{todayIpdCount} IPD</strong></p>
        </div>
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Appointment view">
          {[{ key: "upcoming", label: "Upcoming Appointments", count: items.length }, { key: "past", label: "Past Appointments", count: pastItems.length }].map((tab) => <button key={tab.key} type="button" aria-pressed={view === tab.key} onClick={() => { setView(tab.key as "upcoming" | "past"); setPeriod("all"); setLimit(12); }} className={`rounded-lg px-3 py-2 text-sm font-semibold ${view === tab.key ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}>{tab.label} ({tab.count})</button>)}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <select aria-label="Appointment period" value={period} onChange={(event) => { setPeriod(event.target.value); setLimit(12); }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
            <option value="all">{view === "past" ? "Past 90 days" : "Next 90 days"}</option><option value="today">{view === "past" ? "Yesterday" : "Today"}</option><option value="week">{view === "past" ? "Last 7 days" : "Next 7 days"}</option>
          </select>
          <select aria-label="Appointment type" value={kind} onChange={(event) => { setKind(event.target.value); setLimit(12); }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
            <option value="all">All appointments</option><option value="opd">OPD</option><option value="ipd">IPD / Surgery</option>
          </select>
          <select aria-label="Appointment status" value={appointmentStatus} onChange={event=>{setAppointmentStatus(event.target.value);setLimit(12);}} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"><option value="all">All statuses</option>{["booked","confirmed","arrived","completed","cancelled","no_show"].map(value=><option key={value} value={value}>{value.replace("_"," ")}</option>)}</select>
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 focus-within:ring-2 focus-within:ring-blue-500">
            <Search aria-hidden="true" className="size-4 shrink-0 text-slate-400" /><input aria-label="Search appointments" placeholder="Search patient, phone or agent" value={search} onChange={(event) => { setSearch(event.target.value); setLimit(12); }} className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
          </label>
        </div>
      </div>
      <div className="p-4 sm:p-5">
        <p role="status" className="mb-3 text-xs text-slate-500">{filtered.length} appointments · Dates in clinic time (IST)</p>
        {filtered.length === 0 ? <div className="rounded-xl bg-slate-50 p-8 text-center"><CalendarCheck aria-hidden="true" className="mx-auto mb-3 size-8 text-slate-400" /><p className="font-medium text-slate-700">No appointments {period === "today" ? (view === "past" ? "yesterday" : "today") : "in this view"}</p><p className="mt-1 text-sm text-slate-500">Try another filter or choose a date in the calendar below.</p></div> : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.slice(0, limit).map((item) => <li key={item.appointmentId} className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-start justify-between gap-3"><Link prefetch={false} href={`/dashboard/leads?q=${encodeURIComponent(item.phone === "-" ? item.leadName : item.phone)}#lead-list`} className="min-w-0 truncate font-semibold text-slate-900 hover:text-blue-700">{item.leadName}</Link><span className={`shrink-0 rounded-lg px-2 py-1 text-xs font-semibold ${item.date === todayIso ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}>{item.date === todayIso ? "Today" : new Date(item.date + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}</span></div>
              <p className={`mt-2 text-xs font-semibold ${item.kind === "ipdDone" ? "text-violet-700" : "text-blue-700"}`}>{item.kindLabel}{item.time ? ` · ${item.time} IST` : ""}</p>
              <p className="mt-1 truncate text-xs text-slate-500">Agent: {item.agent === "-" ? "Unassigned" : item.agent}</p>
              {showAttribution && item.bookedBy && <p className="mt-1 truncate text-xs text-slate-500">Booked by: {item.bookedBy}</p>}
              {showAttribution && item.completedBy && <p className="mt-1 truncate text-xs text-slate-500">Completed by: {item.completedBy}</p>}
              {item.phone !== "-" && <div className="mt-3 flex flex-wrap items-center gap-2"><PhonePreview value={item.phone} className="text-xs text-slate-600" /><a href={`tel:${item.phone.replace(/[^+\d]/g, "")}`} className="inline-flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100"><Phone aria-hidden="true" className="size-3.5" />Call</a></div>}
              <AppointmentStatusActions id={item.appointmentId} status={item.appointmentStatus}/>
              {canEdit && <div className="mt-3"><AppointmentEditor agents={agents} defaultDate={item.date} leadId={item.leadId} defaultKind={item.kind} appointmentId={item.appointmentId} updatedAt={item.updatedAt} status={item.appointmentStatus} time={item.time} notes={item.notes} label="Edit appointment" /></div>}
            </li>)}
          </ul>
        )}
        {filtered.length > limit && <Button variant="outline" className="mt-4 w-full" onClick={() => setLimit((current) => current + 12)}>Show more appointments ({filtered.length - limit} remaining)</Button>}
      </div>
    </section>
  );
}
