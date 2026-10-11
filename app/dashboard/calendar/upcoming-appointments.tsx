"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarCheck, Phone, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CalendarAppointment } from "./actions";

export function UpcomingAppointments({ items, todayIso }: { items: CalendarAppointment[]; todayIso: string }) {
  const [period, setPeriod] = useState("all");
  const [kind, setKind] = useState("all");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(12);
  const weekEnd = new Date(todayIso + "T00:00:00Z");
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  const query = search.trim().toLowerCase();
  const filtered = items.filter((item) =>
    (period !== "today" || item.date === todayIso) &&
    (period !== "week" || item.date <= weekEnd.toISOString().slice(0, 10)) &&
    (kind === "all" || (kind === "ipd" ? item.kind === "ipdDone" : item.kind !== "ipdDone")) &&
    (!query || `${item.leadName} ${item.phone} ${item.agent}`.toLowerCase().includes(query)),
  );
  const todayItems = items.filter((item) => item.date === todayIso);
  const todayOpdCount = new Set(todayItems.filter((item) => item.kind !== "ipdDone").map((item) => item.leadId)).size;
  const todayIpdCount = new Set(todayItems.filter((item) => item.kind === "ipdDone").map((item) => item.leadId)).size;
  return (
    <section aria-label="Upcoming appointments" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-slate-50/60 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-semibold text-slate-900"><CalendarCheck aria-hidden="true" className="size-5 text-blue-600" />Patient schedule</h2>
          <p className="text-sm text-slate-600">Today: <strong>{todayOpdCount} OPD</strong> · <strong>{todayIpdCount} IPD</strong></p>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <select aria-label="Appointment period" value={period} onChange={(event) => { setPeriod(event.target.value); setLimit(12); }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
            <option value="all">Next 90 days</option><option value="today">Today</option><option value="week">Next 7 days</option>
          </select>
          <select aria-label="Appointment type" value={kind} onChange={(event) => { setKind(event.target.value); setLimit(12); }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
            <option value="all">All appointments</option><option value="opd">OPD</option><option value="ipd">IPD / Surgery</option>
          </select>
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 focus-within:ring-2 focus-within:ring-blue-500">
            <Search aria-hidden="true" className="size-4 shrink-0 text-slate-400" /><input aria-label="Search appointments" placeholder="Search patient, phone or agent" value={search} onChange={(event) => { setSearch(event.target.value); setLimit(12); }} className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
          </label>
        </div>
      </div>
      <div className="p-4 sm:p-5">
        <p role="status" className="mb-3 text-xs text-slate-500">{filtered.length} appointments · Dates in clinic time (IST)</p>
        {filtered.length === 0 ? <div className="rounded-xl bg-slate-50 p-8 text-center"><CalendarCheck aria-hidden="true" className="mx-auto mb-3 size-8 text-slate-400" /><p className="font-medium text-slate-700">No appointments {period === "today" ? "today" : "in this view"}</p><p className="mt-1 text-sm text-slate-500">Try another filter or choose a date in the calendar below.</p></div> : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.slice(0, limit).map((item) => <li key={`${item.leadId}-${item.kind}`} className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-start justify-between gap-3"><Link prefetch={false} href={`/dashboard/leads?q=${encodeURIComponent(item.phone === "-" ? item.leadName : item.phone)}#lead-list`} className="min-w-0 truncate font-semibold text-slate-900 hover:text-blue-700">{item.leadName}</Link><span className={`shrink-0 rounded-lg px-2 py-1 text-xs font-semibold ${item.date === todayIso ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}>{item.date === todayIso ? "Today" : new Date(item.date + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}</span></div>
              <p className={`mt-2 text-xs font-semibold ${item.kind === "ipdDone" ? "text-violet-700" : "text-blue-700"}`}>{item.kindLabel}</p>
              <p className="mt-1 truncate text-xs text-slate-500">Agent: {item.agent === "-" ? "Unassigned" : item.agent}</p>
              {item.phone !== "-" && <a href={`tel:${item.phone.replace(/[^+\d]/g, "")}`} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100"><Phone aria-hidden="true" className="size-3.5" />{item.phone}</a>}
            </li>)}
          </ul>
        )}
        {filtered.length > limit && <Button variant="outline" className="mt-4 w-full" onClick={() => setLimit((current) => current + 12)}>Show more appointments ({filtered.length - limit} remaining)</Button>}
      </div>
    </section>
  );
}
