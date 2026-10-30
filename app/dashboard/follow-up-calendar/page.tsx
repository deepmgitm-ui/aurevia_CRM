import Link from "next/link";
import { redirect } from "next/navigation";

import { getViewer } from "@/app/actions/leads";
import { createClient } from "@/lib/supabase/server";
import { isWorkDate } from "@/lib/daily-work";
import { buildMonthCells } from "../calendar/month-grid";

type FollowUp = { id: string; name: string; status: string; follow_up_day: string };

export default async function FollowUpCalendar({ searchParams }: {
  searchParams: Promise<{ month?: string; date?: string }>;
}) {
  const viewer = await getViewer();
  if (!viewer.success || !viewer.data) redirect("/login");
  const params = await searchParams;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month ?? "") ? params.month! : today.slice(0, 7);
  const cells = buildMonthCells(month);
  const selected = isWorkDate(params.date ?? "") && params.date?.slice(0, 7) === month ? params.date : month === today.slice(0, 7) ? today : `${month}-01`;
  const offsetMonth = (offset: number) => {
    const date = new Date(`${month}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + offset);
    return date.toISOString().slice(0, 7);
  };
  const leads: FollowUp[] = [];
  let error = "";
  const name = viewer.data.name.trim();
  if (!name || ["-", "unassigned"].includes(name.toLowerCase())) error = "Your profile needs a valid name to load assigned follow-ups.";
  else {
    const supabase = await createClient();
    for (let offset = 0; ; offset += 500) {
      const result = await supabase.from("leads").select("id,name,status,follow_up_day")
        .ilike("assigned_to", name.replace(/[\\%_]/g, "\\$&"))
        .gte("follow_up_day", cells[0].iso).lte("follow_up_day", cells.at(-1)!.iso)
        .order("follow_up_day").order("id").range(offset, offset + 499);
      if (result.error) { error = "Follow-ups could not be loaded. Please try again."; break; }
      leads.push(...((result.data ?? []) as FollowUp[]));
      if (!result.data || result.data.length < 500) break;
    }
  }
  const counts = new Map<string, number>();
  for (const lead of leads) counts.set(lead.follow_up_day, (counts.get(lead.follow_up_day) ?? 0) + 1);
  const dayLeads = leads.filter((lead) => lead.follow_up_day === selected);
  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <div><h1 className="text-2xl font-semibold text-slate-950">Follow-up Calendar</h1><p className="mt-2 text-sm text-slate-500">Follow-up dates for leads currently assigned to you.</p></div>
      {error ? <p role="alert" className="rounded-lg bg-rose-50 p-4 text-sm text-rose-800">{error}</p> : <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-4 flex items-center justify-between gap-3"><Link className="text-sm text-emerald-700" href={`?month=${offsetMonth(-1)}`}>Previous</Link><h2 className="font-semibold">{new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })}</h2><Link className="text-sm text-emerald-700" href={`?month=${offsetMonth(1)}`}>Next</Link></div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-slate-500">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <span key={day} className="py-2">{day}</span>)}</div>
          <div className="grid grid-cols-7 gap-1">{cells.map((cell) => <Link key={cell.iso} href={`?month=${cell.iso.slice(0, 7)}&date=${cell.iso}`} aria-label={`${cell.iso}: ${counts.get(cell.iso) ?? 0} follow-ups`} aria-current={cell.iso === selected ? "date" : undefined} className={`min-h-16 rounded-lg border p-2 text-sm ${cell.iso === selected ? "border-emerald-600 bg-emerald-50" : "border-slate-100"} ${cell.isCurrentMonth ? "text-slate-800" : "text-slate-400"}`}><span>{cell.day}</span>{Boolean(counts.get(cell.iso)) && <span className="mt-1 block text-xs font-semibold text-emerald-700">{counts.get(cell.iso)}</span>}</Link>)}</div>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-4"><h2 className="font-semibold">{selected}</h2>{dayLeads.length === 0 ? <p className="mt-3 text-sm text-slate-500">No follow-ups scheduled for this day.</p> : <ul className="mt-3 space-y-2">{dayLeads.map((lead) => <li key={lead.id} className="rounded-lg bg-slate-50 p-3"><p className="font-medium text-slate-900">{lead.name}</p><p className="text-xs text-slate-500">{lead.status}</p></li>)}</ul>}</section>
      </div>}
    </div>
  );
}
