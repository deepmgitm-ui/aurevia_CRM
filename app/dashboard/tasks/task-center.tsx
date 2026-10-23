"use client";

import { useMemo, useRef, useState } from "react";
import { CalendarClock, CheckCircle2, MessageCircle, Phone, RotateCcw, Search } from "lucide-react";

import {
  completeFollowUp,
  logLeadCall,
  rescheduleFollowUp,
} from "@/app/actions/leads";
import { getTaskPage, type TaskPageData } from "@/app/actions/crm-workflows";
import { trackLeadMutations } from "../lead-mutation-tracker";
import { CALL_OUTCOMES } from "@/lib/calls";
import { getLeadPriorityScore, getPriorityLabel } from "@/lib/lead-score";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";

export type TaskLead = {
  id: string;
  name: string;
  phone: string | null;
  disease: string;
  follow_up_date: string | null;
  status: string;
  assigned_to: string | null;
  source: string;
  remarks: string;
  follow_up_at?: string | null;
  last_touched_at?: string;
};

function dateKey(value: string): string {
  const raw = value?.trim() ?? "";
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const dmy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return raw;
}

function todayKey(): string {
  return new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Kolkata"}).format(new Date());
}

function displayDate(value: string | null): string {
  const key = dateKey(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return value || "Not scheduled";
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
}

export function TaskCenter({ leads: initialLeads, initialPage }: { leads: TaskLead[]; initialPage: TaskPageData }) {
  const [leads, setLeads] = useState(initialLeads);
  const [page,setPage]=useState(1),[total,setTotal]=useState(initialPage.total),[stats,setStats]=useState(initialPage.stats),[loading,setLoading]=useState(false),[requestError,setRequestError]=useState(""),[nextTime,setNextTime]=useState("");
  const [query, setQuery] = useState("");
  const [bucket, setBucket] = useState<"all" | "overdue" | "today" | "upcoming" | "stale">("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [callLead, setCallLead] = useState<TaskLead | null>(null);
  const [callOutcome, setCallOutcome] = useState("Connected");
  const [callNotes, setCallNotes] = useState("");
  const [nextDate, setNextDate] = useState("");

  const today = todayKey();

  const loadSequence=useRef(0);
  async function load(nextBucket=bucket,nextQuery=query,nextPage=page){
    const request=++loadSequence.current;setLoading(true);setRequestError("");
    try{const response=await getTaskPage(nextBucket,nextQuery,nextPage);if(request!==loadSequence.current)return;if(response.success){const last=Math.max(1,Math.ceil(response.data.total/50));if(nextPage>last){await load(nextBucket,nextQuery,last);return;}setLeads(response.data.leads);setTotal(response.data.total);setStats(response.data.stats);setBucket(nextBucket);setPage(nextPage);}else setRequestError(response.error);}
    catch{setRequestError("Follow-ups could not be loaded. Please retry.");}finally{if(request===loadSequence.current)setLoading(false);}
  }
  const visible=useMemo(()=>[...leads].sort((a,b)=>getLeadPriorityScore(b)-getLeadPriorityScore(a)||dateKey(a.follow_up_date ?? "").localeCompare(dateKey(b.follow_up_date ?? ""))),[leads]);

  async function handleComplete(lead: TaskLead) {
    if (busyId) return;
    const originalIndex = leads.findIndex((entry) => entry.id === lead.id);
    setBusyId(lead.id);
    setLeads((current) => current.filter((entry) => entry.id !== lead.id));
    const result = await completeFollowUp(lead.id);
    if (!result.success) {
      setLeads((current) => {
        if (current.some((entry) => entry.id === lead.id)) return current;
        const restored = [...current];
        restored.splice(Math.min(originalIndex, restored.length), 0, lead);
        return restored;
      });
      toast.add({ title: "Unable to complete follow-up", description: result.error, type: "error" });
    } else {
      toast.add({ title: "Follow-up completed", description: lead.name, type: "success" });
      await load();
    }
    setBusyId(null);
  }

  function openCall(lead: TaskLead) {
    setCallLead(lead);
    setCallOutcome("Connected");
    setCallNotes("");
    setNextDate("");setNextTime("");
  }

  async function handleLogCall(moveNext=false) {
    if (!callLead || busyId) return;
    const lead = callLead;
    const previousDate = lead.follow_up_date;
    trackLeadMutations(lead.id);
    setBusyId(callLead.id);
    if (nextDate) {
      setLeads((current) =>
        current.map((entry) =>
          entry.id === lead.id ? { ...entry, follow_up_date: nextDate } : entry,
        ),
      );
    }
    const result = await logLeadCall({
      lead_id: lead.id,
      outcome: callOutcome,
      notes: callNotes,
      next_follow_up_date: nextDate || null,
      next_follow_up_time: nextTime || null,
    });
    if (!result.success) {
      if (nextDate) {
        setLeads((current) =>
          current.map((entry) =>
            entry.id === lead.id ? { ...entry, follow_up_date: previousDate } : entry,
          ),
        );
      }
      toast.add({ title: "Unable to log call", description: result.error, type: "error" });
    } else {
      toast.add({
        title: "Call logged",
        description: nextDate ? `Next follow-up set for ${displayDate(nextDate)}.` : "Call added to the activity timeline.",
        type: "success",
      });
      const next=visible[visible.findIndex(item=>item.id===lead.id)+1];
      await load();
      if(moveNext&&next)openCall(next);else setCallLead(null);
    }
    setBusyId(null);
  }

  async function handleReschedule(lead: TaskLead, value: string) {
    if (!value || busyId) return;
    setBusyId(lead.id);
    setLeads((current) =>
      current.map((entry) =>
        entry.id === lead.id ? { ...entry, follow_up_date: value } : entry,
      ),
    );
    const result = await rescheduleFollowUp(lead.id, value);
    if (!result.success) {
      setLeads((current) =>
        current.map((entry) =>
          entry.id === lead.id
            ? { ...entry, follow_up_date: lead.follow_up_date }
            : entry,
        ),
      );
      toast.add({ title: "Unable to reschedule", description: result.error, type: "error" });
    } else {
      toast.add({ title: "Follow-up rescheduled", description: `${lead.name} → ${displayDate(value)}`, type: "success" });
      await load();
    }
    setBusyId(null);
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {[
          { label: "All follow-ups", value: stats.total, active: bucket === "all", next: "all" as const },
          { label: "Overdue", value: stats.overdue, active: bucket === "overdue", next: "overdue" as const },
          { label: "Due today", value: stats.today, active: bucket === "today", next: "today" as const },
          { label: "Upcoming", value: stats.upcoming, active: bucket === "upcoming", next: "upcoming" as const },
          { label: "No update · 3+ days", value: stats.stale, active: bucket === "stale", next: "stale" as const },
        ].map((card) => (
          <button
            key={card.label}
            type="button"
            disabled={loading||Boolean(busyId)} onClick={() => void load(card.next,query,1)}
            className={`rounded-xl border bg-white p-4 text-left shadow-sm transition hover:border-slate-400 ${card.active ? "border-slate-900 ring-1 ring-slate-900/10" : "border-slate-200"}`}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{card.label}</p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">{card.value}</p>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search all follow-ups: patient, phone or agent" className="pl-9" onKeyDown={event=>{if(event.key==='Enter')void load(bucket,query,1);}} />
        </div>
        <Button disabled={loading} onClick={()=>void load(bucket,query,1)}>Search</Button>
        <Button type="button" variant="outline" disabled={loading} onClick={() => { setQuery(""); void load("all","",1); }}>
          <RotateCcw aria-hidden="true" /> Reset
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Patient</th>
                <th className="px-4 py-3">{bucket === "stale" ? "Last updated" : "Follow-up"}</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr><td colSpan={6} className="h-36 px-4 text-center text-slate-500">No matching follow-ups.</td></tr>
              ) : visible.map((lead) => {
                const score = getLeadPriorityScore(lead);
                const priority = getPriorityLabel(score);
                const key = dateKey(lead.follow_up_date ?? "");
                const isOverdue = bucket !== "stale" && key < today;
                const lastTouched = lead.last_touched_at ? new Date(lead.last_touched_at) : null;
                return (
                  <tr key={lead.id} className="border-b border-slate-100 last:border-b-0">
                    <td className="px-4 py-3 align-top">
                      <div className="font-semibold text-slate-900">{score}</div>
                      <div className="text-xs text-slate-400">{priority}</div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="font-medium text-slate-950">{lead.name}</div>
                      <div className="mt-0.5 text-xs text-slate-500">{lead.disease || "No treatment"} · {lead.source || "Unknown source"}</div>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {lead.phone && lead.phone !== "-" && (
                          <>
                            <a href={`tel:${lead.phone}`} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
                              <Phone className="size-3" /> Call
                            </a>
                            <a href={`https://wa.me/91${lead.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100">
                              <MessageCircle className="size-3" /> WhatsApp
                            </a>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className={`font-semibold ${isOverdue ? "text-rose-600" : key === today ? "text-amber-600" : "text-slate-900"}`}>
                        {bucket === "stale" && lastTouched
                          ? lastTouched.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })
                          : lead.follow_up_date ? displayDate(lead.follow_up_date) : "Not scheduled"}
                        {bucket !== "stale" && lead.follow_up_at?` · ${new Date(lead.follow_up_at).toLocaleTimeString("en-IN",{timeZone:"Asia/Kolkata",hour:"2-digit",minute:"2-digit"})}`:""}
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <CalendarClock className="size-3.5 text-slate-400" />
                        <Input
                          type="date"
                          className="h-8 w-36 text-xs"
                          value={/^\d{4}-\d{2}-\d{2}$/.test(key) ? key : ""}
                          onChange={(event) => void handleReschedule(lead, event.target.value)}
                          disabled={busyId !== null}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="font-medium text-slate-700">{lead.status}</div>
                    </td>
                    <td className="px-4 py-3 align-top text-slate-600">{lead.assigned_to || "-"}</td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex justify-end gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => openCall(lead)} disabled={busyId !== null}>
                          Log Call
                        </Button>
                        <Button type="button" size="sm" onClick={() => void handleComplete(lead)} disabled={busyId !== null}>
                          <CheckCircle2 aria-hidden="true" /> {busyId === lead.id ? "Saving..." : "Done"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><span role="status">{loading?"Loading...":`Page ${page} · ${total} matching follow-ups`}</span><div className="flex gap-2"><Button variant="outline" disabled={loading||page<=1} onClick={()=>void load(bucket,query,page-1)}>Previous</Button><Button variant="outline" disabled={loading||page*50>=total} onClick={()=>void load(bucket,query,page+1)}>Next</Button></div></div>
      {requestError&&<p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{requestError}</p>}
      <Dialog open={Boolean(callLead)} onOpenChange={(open) => !open && !busyId && setCallLead(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Log call — {callLead?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Call outcome</Label>
              <Select value={callOutcome} onValueChange={(value) => setCallOutcome(String(value ?? ""))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CALL_OUTCOMES.map(outcome=><SelectItem key={outcome} value={outcome}>{outcome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="call-notes">Notes</Label>
              <Textarea id="call-notes" rows={4} value={callNotes} onChange={(event) => setCallNotes(event.target.value)} placeholder="What happened on the call?" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="next-follow-up">Next follow-up</Label>
              <Input id="next-follow-up" type="date" value={nextDate} onChange={(event) => setNextDate(event.target.value)} />
            </div>
          </div>
          <label className="block text-sm">Callback time (IST)<Input type="time" value={nextTime} disabled={!nextDate} onChange={event=>setNextTime(event.target.value)}/></label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCallLead(null)}>Cancel</Button>
            <Button type="button" disabled={!callLead || busyId === callLead.id} onClick={() => void handleLogCall()}>
              {busyId === callLead?.id ? "Saving..." : "Save Call"}
            </Button>
            <Button type="button" variant="outline" disabled={!callLead || Boolean(busyId)} onClick={()=>void handleLogCall(true)}>Save & Next Lead</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
