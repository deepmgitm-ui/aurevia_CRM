"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CALENDAR_ENTRY_TYPES, shouldSyncLeadStatus, type CalendarEntryKind } from "@/lib/calendar-entry";
import { getCalendarEditorLead, saveCalendarEntry, searchCalendarLeads, type CalendarEditorLead } from "./entry-actions";
import { PhonePreview } from "../phone-preview";

interface EditorProps {
  defaultDate: string; agents: string[]; leadId?: string; defaultKind?: CalendarEntryKind; label?: string;
  appointmentId?:string;updatedAt?:string;status?:string;time?:string;notes?:string;
}
const inputClass = "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-2 focus:outline-blue-500";
const displayValue = (value?: string | null) => value && value !== "-" ? value : "";

export function AppointmentEditor(props: EditorProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) setOpen(next); }}>
      <Button type="button" variant={props.leadId ? "outline" : "default"} size="sm" onClick={() => setOpen(true)}>{props.label ?? "Add appointment"}</Button>
      {open && <DialogContent showCloseButton={!saving} className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>{props.leadId ? "Edit appointment" : "Add patient appointment"}</DialogTitle><DialogDescription>Choose a patient, enter their details and select the appointment date.</DialogDescription></DialogHeader>
        <EditorForm {...props} onSaving={setSaving} onClose={() => setOpen(false)} />
      </DialogContent>}
    </Dialog>
  );
}

function EditorForm({ defaultDate, defaultKind = "opdBooked", leadId, agents, appointmentId,updatedAt,status,time,notes, onSaving, onClose }: EditorProps & { onSaving: (value: boolean) => void; onClose: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [selected, setSelected] = useState<CalendarEditorLead | null>(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<CalendarEditorLead[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(Boolean(leadId));
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const [appointmentStatus,setAppointmentStatus]=useState(status || (defaultKind==="opdDone"?"completed":"booked"));
  const [kind, setKind] = useState<CalendarEntryKind>(defaultKind);
  const [error, setError] = useState("");
  const [savedWarning, setSavedWarning] = useState("");
  useEffect(() => {
    if (!leadId) return;
    let active = true;
    void getCalendarEditorLead(leadId).then((response) => {
      if (!active) return;
      if (response.success) setSelected(response.data);
      else setError(response.error);
    }).catch(() => { if (active) setError("Could not load this patient. Please search again."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [leadId]);

  async function findPatients(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true); setError(""); setSearched(false);
    try {
      const response = await searchCalendarLeads(search);
      if (response.success) { setResults(response.data); setSearched(true); }
      else { setResults([]); setError(response.error); }
    } catch { setError("Search could not be completed. Please retry."); }
    finally { setLoading(false); }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveLock.current) return;
    saveLock.current = true;
    const data = new FormData(event.currentTarget);
    setSaving(true); onSaving(true); setError("");
    try {
      const date = String(data.get("date") ?? "");
      const response = await saveCalendarEntry({ mode, leadId: selected?.id, expectedUpdatedAt: selected?.updated_at,
        kind, date, name: String(data.get("name") ?? ""), phone: String(data.get("phone") ?? ""),
        city: String(data.get("city") ?? ""), remarks: String(data.get("remarks") ?? ""),
        assignedTo: String(data.get("assignedTo") ?? ""), appointmentId,expectedAppointmentUpdatedAt:updatedAt,appointmentStatus:String(data.get("appointmentStatus")),time:String(data.get("time") ?? ""),appointmentNotes:String(data.get("appointmentNotes") ?? ""),updateStatus: mode === "existing" && shouldSyncLeadStatus(appointmentStatus) });
      if (!response.success) { setError(response.error); return; }
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
      router.push(`/dashboard/calendar?month=${date.slice(0, 7)}&date=${date}&view=${date < today ? "past" : "upcoming"}`);
      router.refresh();
      if (response.data.warning) setSavedWarning(response.data.warning);
      else onClose();
    } catch { setError("Appointment could not be saved. Please retry."); }
    finally { saveLock.current = false; setSaving(false); onSaving(false); }
  }

  if (savedWarning) return <div className="space-y-4"><p role="status" className="text-sm text-amber-700">{savedWarning}</p><Button onClick={onClose}>Done</Button></div>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Button variant={mode === "existing" ? "default" : "outline"} disabled={loading || saving} onClick={() => { setMode("existing"); setError(""); }}>Existing patient / lead</Button>
        <Button variant={mode === "new" ? "default" : "outline"} disabled={loading || saving || Boolean(appointmentId)} onClick={() => { setMode("new"); setError(""); }}>New patient / lead</Button>
      </div>
      {loading && <p role="status" className="text-sm text-slate-500">Loading patients...</p>}
      {mode === "existing" && !selected && <>
        <form onSubmit={findPatients} className="flex items-end gap-2">
          <label className="min-w-0 flex-1 text-xs font-medium text-slate-600">Patient name or phone<input value={search} onChange={(event) => setSearch(event.target.value)} minLength={2} maxLength={120} required disabled={loading} className={inputClass} /></label>
          <Button type="submit" variant="outline" disabled={loading}>Search</Button>
        </form>
        {searched && results.length === 0 && <p className="text-sm text-slate-500">No patients found. Search another name or add a new patient.</p>}
        <ul className="max-h-48 space-y-2 overflow-y-auto">{results.map((patient) => <li key={patient.id}><div className="w-full rounded-xl border border-slate-200 p-3 text-left hover:border-blue-400 hover:bg-blue-50"><button type="button" onClick={() => { setSelected(patient); setError(""); }} className="block w-full text-left"><span className="block text-sm font-semibold">{patient.name}</span><span className="text-xs text-slate-500">{patient.status} · {patient.assigned_to || "Unassigned"}</span></button><PhonePreview value={displayValue(patient.phone)} className="mt-1 text-xs text-slate-600" /></div></li>)}</ul>
        {results.length === 20 && <p className="text-xs text-slate-500">Showing the first 20 matches. Search a more specific name or phone.</p>}
      </>}
      {(mode === "new" || selected) && !loading && <form key={mode === "new" ? "new" : selected?.id} onSubmit={save} className="space-y-4">
        <fieldset disabled={saving} className="space-y-4">
          {mode === "existing" && selected && <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600"><p>Current status: <strong>{selected.status}</strong> · Agent: {selected.assigned_to || "Unassigned"}</p><p className="mt-1">Current {CALENDAR_ENTRY_TYPES[kind].label} date: {selected[CALENDAR_ENTRY_TYPES[kind].column] || "Not set"}</p><button type="button" disabled={Boolean(appointmentId)} className="mt-2 font-semibold text-blue-700 disabled:hidden" onClick={() => { setSelected(null); setResults([]); setSearched(false); setError(""); }}>Choose / reload patient</button></div>}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-slate-600">Patient name<input name="name" required maxLength={200} defaultValue={mode === "existing" ? selected?.name : ""} className={inputClass} /></label>
            <label className="text-xs font-medium text-slate-600">Phone<input name="phone" type="tel" maxLength={30} defaultValue={mode === "existing" ? displayValue(selected?.phone) : ""} className={inputClass} /></label>
            <label className="text-xs font-medium text-slate-600">Appointment type<select value={kind} onChange={(event) => setKind(event.target.value as CalendarEntryKind)} className={inputClass}>{Object.entries(CALENDAR_ENTRY_TYPES).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></label>
            <label className="text-xs font-medium text-slate-600">Appointment date<input type="date" name="date" required defaultValue={defaultDate} className={inputClass} /></label>
            <label className="text-xs font-medium text-slate-600">Appointment status<select name="appointmentStatus" value={appointmentStatus} onChange={event=>setAppointmentStatus(event.target.value)} className={inputClass}>{["booked","confirmed","arrived","completed","cancelled","no_show"].map(value=><option key={value} value={value}>{value.replace('_',' ')}</option>)}</select></label>
            <label className="text-xs font-medium text-slate-600">Time (IST, optional)<input type="time" name="time" defaultValue={time || ""} className={inputClass}/></label>
            <label className="text-xs font-medium text-slate-600">City<input name="city" maxLength={200} defaultValue={mode === "existing" ? displayValue(selected?.city) : ""} className={inputClass} /></label>
            {mode === "new" && <label className="text-xs font-medium text-slate-600">Assign to agent<select name="assignedTo" className={inputClass}><option value="">Unassigned</option>{agents.map((agent) => <option key={agent} value={agent}>{agent}</option>)}</select></label>}
          </div>
          <label className="block text-xs font-medium text-slate-600">Appointment notes<textarea name="appointmentNotes" defaultValue={notes || ""} rows={2} maxLength={5000} className={inputClass}/></label>
          <label className="block text-xs font-medium text-slate-600">Patient notes<textarea name="remarks" maxLength={5000} rows={3} defaultValue={mode === "existing" ? displayValue(selected?.remarks) : ""} className={inputClass} /></label>
          {mode === "existing" && shouldSyncLeadStatus(appointmentStatus) ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">Saving this appointment will update the lead&apos;s current status to <strong>{appointmentStatus==="completed"?(kind==="ipdDone"?"IPD Done":"OPD Done"):(kind==="ipdDone"?"IPD Booked":"OPD Booked")}</strong>. Only this current appointment status will appear on the calendar.</p> : mode === "existing" ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Cancelled or no-show appointments won&apos;t change the lead&apos;s current pipeline status.</p> : <p className="text-xs text-slate-500">A new CRM lead and a separate appointment record will be created.</p>}
          <p className="text-xs text-slate-500">Earlier visits are preserved. Editing this appointment records its date and status history.</p>
        </fieldset>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? "Saving..." : "Save appointment"}</Button></div>
      </form>}
      {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    </div>
  );
}
