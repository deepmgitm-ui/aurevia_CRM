"use client";

import { useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, MessageCircle, Phone, RotateCcw, Search } from "lucide-react";

import {
  completeFollowUp,
  logLeadCall,
  rescheduleFollowUp,
} from "@/app/actions/leads";
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
  follow_up_date: string;
  status: string;
  temperature: string;
  assigned_to: string | null;
  source: string;
  remarks: string;
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
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function displayDate(value: string): string {
  const key = dateKey(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return value;
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
}

export function TaskCenter({ leads: initialLeads }: { leads: TaskLead[] }) {
  const [leads, setLeads] = useState(initialLeads);
  const [query, setQuery] = useState("");
  const [bucket, setBucket] = useState<"all" | "overdue" | "today" | "upcoming">("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [callLead, setCallLead] = useState<TaskLead | null>(null);
  const [callOutcome, setCallOutcome] = useState("Connected");
  const [callNotes, setCallNotes] = useState("");
  const [nextDate, setNextDate] = useState("");

  const today = todayKey();

  const stats = useMemo(() => {
    let overdue = 0;
    let todayCount = 0;
    let upcoming = 0;
    for (const lead of leads) {
      const key = dateKey(lead.follow_up_date);
      if (key < today) overdue += 1;
      else if (key === today) todayCount += 1;
      else if (key > today) upcoming += 1;
    }
    return { overdue, today: todayCount, upcoming, total: leads.length };
  }, [leads, today]);

  const visible = useMemo(() => {
    return [...leads]
      .filter((lead) => {
        const key = dateKey(lead.follow_up_date);
        if (bucket === "overdue" && !(key < today)) return false;
        if (bucket === "today" && key !== today) return false;
        if (bucket === "upcoming" && !(key > today)) return false;
        const term = query.trim().toLowerCase();
        if (!term) return true;
        return [lead.name, lead.phone ?? "", lead.disease, lead.status, lead.source, lead.assigned_to ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(term);
      })
      .sort((a, b) => {
        const scoreDiff = getLeadPriorityScore(b) - getLeadPriorityScore(a);
        if (scoreDiff !== 0) return scoreDiff;
        return dateKey(a.follow_up_date).localeCompare(dateKey(b.follow_up_date));
      });
  }, [leads, bucket, query, today]);

  async function handleComplete(lead: TaskLead) {
    setBusyId(lead.id);
    const result = await completeFollowUp(lead.id);
    if (!result.success) {
      toast.add({ title: "Unable to complete follow-up", description: result.error, type: "error" });
    } else {
      setLeads((current) => current.filter((entry) => entry.id !== lead.id));
      toast.add({ title: "Follow-up completed", description: lead.name, type: "success" });
    }
    setBusyId(null);
  }

  function openCall(lead: TaskLead) {
    setCallLead(lead);
    setCallOutcome("Connected");
    setCallNotes("");
    setNextDate("");
  }

  async function handleLogCall() {
    if (!callLead) return;
    setBusyId(callLead.id);
    const result = await logLeadCall({
      lead_id: callLead.id,
      outcome: callOutcome,
      notes: callNotes,
      next_follow_up_date: nextDate || null,
    });
    if (!result.success) {
      toast.add({ title: "Unable to log call", description: result.error, type: "error" });
    } else {
      if (nextDate) {
        setLeads((current) =>
          current.map((entry) =>
            entry.id === callLead.id ? { ...entry, follow_up_date: nextDate } : entry,
          ),
        );
      }
      toast.add({
        title: "Call logged",
        description: nextDate ? `Next follow-up set for ${displayDate(nextDate)}.` : "Call added to the activity timeline.",
        type: "success",
      });
      setCallLead(null);
    }
    setBusyId(null);
  }

  async function handleReschedule(lead: TaskLead, value: string) {
    if (!value) return;
    setBusyId(lead.id);
    const result = await rescheduleFollowUp(lead.id, value);
    if (!result.success) {
      toast.add({ title: "Unable to reschedule", description: result.error, type: "error" });
    } else {
      setLeads((current) =>
        current.map((entry) => entry.id === lead.id ? { ...entry, follow_up_date: value } : entry),
      );
      toast.add({ title: "Follow-up rescheduled", description: `${lead.name} → ${displayDate(value)}`, type: "success" });
    }
    setBusyId(null);
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "All follow-ups", value: stats.total, active: bucket === "all", next: "all" as const },
          { label: "Overdue", value: stats.overdue, active: bucket === "overdue", next: "overdue" as const },
          { label: "Due today", value: stats.today, active: bucket === "today", next: "today" as const },
          { label: "Upcoming", value: stats.upcoming, active: bucket === "upcoming", next: "upcoming" as const },
        ].map((card) => (
          <button
            key={card.label}
            type="button"
            onClick={() => setBucket(card.next)}
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
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search patient, phone, treatment, employee..." className="pl-9" />
        </div>
        <Button type="button" variant="outline" onClick={() => { setQuery(""); setBucket("all"); }}>
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
                <th className="px-4 py-3">Follow-up</th>
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
                const key = dateKey(lead.follow_up_date);
                const isOverdue = key < today;
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
                        {displayDate(lead.follow_up_date)}
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <CalendarClock className="size-3.5 text-slate-400" />
                        <Input
                          type="date"
                          className="h-8 w-36 text-xs"
                          value={/^\d{4}-\d{2}-\d{2}$/.test(key) ? key : ""}
                          onChange={(event) => void handleReschedule(lead, event.target.value)}
                          disabled={busyId === lead.id}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="font-medium text-slate-700">{lead.status}</div>
                      <div className="mt-1 text-xs text-slate-500">{lead.temperature}</div>
                    </td>
                    <td className="px-4 py-3 align-top text-slate-600">{lead.assigned_to || "-"}</td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex justify-end gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => openCall(lead)} disabled={busyId === lead.id}>
                          Log Call
                        </Button>
                        <Button type="button" size="sm" onClick={() => void handleComplete(lead)} disabled={busyId === lead.id}>
                          <CheckCircle2 aria-hidden="true" /> Done
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

      <Dialog open={Boolean(callLead)} onOpenChange={(open) => !open && setCallLead(null)}>
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
                  <SelectItem value="Connected">Connected</SelectItem>
                  <SelectItem value="No Answer">No Answer</SelectItem>
                  <SelectItem value="DNP">DNP</SelectItem>
                  <SelectItem value="RNR">RNR</SelectItem>
                  <SelectItem value="Interested">Interested</SelectItem>
                  <SelectItem value="Not Interested">Not Interested</SelectItem>
                  <SelectItem value="Requested Callback">Requested Callback</SelectItem>
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
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCallLead(null)}>Cancel</Button>
            <Button type="button" disabled={!callLead || busyId === callLead.id} onClick={() => void handleLogCall()}>
              Save Call
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
