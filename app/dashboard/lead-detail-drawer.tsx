// Aurevia CRM — lead detail drawer, shared by every surface that opens ONE lead.
// Pipeline bars, patient tables and calendar chips all land here, so a tap on
// any of them shows the SAME view/edit screen (Zoho-style: tap → record opens,
// edits + activity + call + follow-up — no separate "edit page" needed).
"use client";

import { useCallback, useEffect, useState } from "react";

import { CalendarDays, Loader2, MessageSquareText, PhoneCall, TimerReset, X } from "lucide-react";

import {
  addLeadActivity,
  getLeadActivities,
  getLeadsPage,
  getViewer,
  logLeadCall,
  updateLeadDetails,
  type Lead,
  type LeadActivity,
  type UpdateLeadDetailsInput,
} from "@/app/actions/leads";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";

import { relativeLeadAge } from "./lead-filters";
import { getMasterData } from "@/app/actions/master-data";
import { seedMasterData, withCurrentValue } from "@/lib/master-data";

export type LeadDetailTab = "info" | "activity" | "call";

/**
 * Boot options only — the real list comes from the DB (Settings → Master Data)
 * and always includes whatever status this lead already has, so a saved value
 * can never silently reset to "New".
 */
const STATUS_OPTIONS = [
  "New",
  "Contacted",
  "DNP",
  "Consultation Booked",
  "Consultation Attended",
  "Surgery Completed",
  "Lost",
  "Dropped",
] as const;

const OUTCOME_OPTIONS = ["Connected", "DNP", "RNR", "Call Back Later", "Switched Off", "Not Reachable"] as const;

function emptyCallDraft() {
  return { outcome: "Connected", notes: "", nextDate: "" };
}

function toDateInput(value: string | null | undefined): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized === "-") return "";
  const dmy = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  const iso = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  return "";
}

/** Zoho-style record view: tap anywhere → full patient journey + edit. */
export function LeadDetailDrawer({
  leadId,
  tab = "info",
  open,
  title,
  onOpenChange,
  onMutated,
}: {
  /** `null` keeps the drawer mounted but hidden — parents never unmount it. */
  leadId: string | null;
  tab?: LeadDetailTab;
  open: boolean;
  /** e.g. "Surgery Completed · LASIK" — contextual caption above the name. */
  title?: string;
  onOpenChange: (open: boolean) => void;
  /** Fired after any save so the parent list can refresh that row. */
  onMutated?: (lead: Lead) => void;
}) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [activeTab, setActiveTab] = useState<LeadDetailTab>(tab);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activities, setActivities] = useState<LeadActivity[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [edits, setEdits] = useState({
    name: "",
    phone: "",
    email: "",
    gender: "",
    city: "",
    insurance: "",
    status: "",
    temperature: "",
    treatment: "",
    followUpDate: "",
  });
  // Core fields are admin/manager-only server-side (updateLeadDetails strips
  // them for employees), so the UI asks who is looking instead of letting an
  // employee type into a field that would silently not save.
  const [canEditCore, setCanEditCore] = useState(false);
  const [masterStatuses, setMasterStatuses] = useState<string[]>(() =>
    Array.from(new Set([...seedMasterData().lists.statuses, ...STATUS_OPTIONS])),
  );
  const [masterTemperatures, setMasterTemperatures] = useState<string[]>(
    () => seedMasterData().lists.temperatures,
  );
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [callDraft, setCallDraft] = useState(emptyCallDraft());

  const load = useCallback(
    async (id: string) => {
      setLoading(true);
      setLead(null);
      const response = await getLeadsPage(1, 1, "", "", "", {}, [id]);
      setLoading(false);
      if (!response.success || response.data.leads.length === 0) {
        toast.add({
          title: "Could not load lead",
          description: response.success ? "This lead is not visible in this view." : response.error,
          type: "error",
        });
        return;
      }
      const fresh = response.data.leads[0];
      setLead(fresh);
      setActiveTab(tab);
      setEdits({
        name: fresh.name,
        phone: fresh.phone ?? "",
        email: fresh.email && fresh.email !== "-" ? fresh.email : "",
        gender: fresh.gender && fresh.gender !== "-" ? fresh.gender : "",
        city: fresh.city && fresh.city !== "-" ? fresh.city : "",
        insurance: fresh.insurance_status && fresh.insurance_status !== "-" ? fresh.insurance_status : "",
        status: fresh.status && fresh.status !== "-" ? fresh.status : "New",
        temperature: fresh.temperature && fresh.temperature !== "-" ? fresh.temperature : "",
        treatment: fresh.disease && fresh.disease !== "-" ? fresh.disease : "",
        followUpDate: toDateInput(fresh.follow_up_date),
      });
      setNote("");
      setCallDraft(emptyCallDraft());
      setLoadingActivities(true);
      const activityResponse = await getLeadActivities(id);
      setLoadingActivities(false);
      if (activityResponse.success) setActivities(activityResponse.data);
    },
    [tab],
  );

  // Fetch on open. The timer runs `load` OUTSIDE the effect body, so every
  // setState lands in an async callback (react-hooks/set-state-in-effect rule).
  useEffect(() => {
    if (!open || !leadId) return;
    const handle = setTimeout(() => void load(leadId), 0);
    return () => clearTimeout(handle);
  }, [open, leadId, load]);

  // Master data (Settings → Master Data): admin's stage list replaces the seed.
  useEffect(() => {
    void getMasterData().then((result) => {
      if (result.success && result.data) {
        setMasterStatuses(result.data.lists.statuses);
        setMasterTemperatures(result.data.lists.temperatures);
      }
    });
    void getViewer().then((result) => {
      if (result.success && result.data) {
        setCanEditCore(result.data.role === "admin" || result.data.role === "manager");
      }
    });
  }, []);

  const tabButton = (key: LeadDetailTab, label: string) => (
    <button
      key={key}
      type="button"
      onClick={() => setActiveTab(key)}
      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
        activeTab === key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      {label}
    </button>
  );

  if (!open) return null;

  async function persist(patch: Partial<UpdateLeadDetailsInput>, successTitle: string) {
    if (!lead) return;
    setSaving(true);
    const optimistic = { ...lead, ...patch, id: lead.id };
    setLead(optimistic);
    onMutated?.(optimistic);
    const update = await updateLeadDetails({ ...patch, id: lead.id });
    if (!update.success) {
      setLead(lead);
      onMutated?.(lead);
      toast.add({ title: "Could not save", description: update.error, type: "error" });
      setSaving(false);
      return;
    }
    setLead(update.data);
    onMutated?.(update.data);
    toast.add({ title: successTitle });
    setSaving(false);
  }

  async function handleInfoSave() {
    if (!lead) return;
    await persist(
      {
        name: edits.name.trim() || lead.name,
        phone: edits.phone.trim(),
        status: edits.status,
        // Stage + temperature are the two fields employees may change, so they
        // go out for everyone.
        temperature: edits.temperature,
        disease: edits.treatment.trim() || "-",
        follow_up_date: edits.followUpDate || "-",
        // Core fields are ignored server-side for employees — send them only
        // when this viewer is allowed, so the toast never lies about a save.
        ...(canEditCore
          ? {
              email: edits.email.trim() || "-",
              gender: edits.gender.trim() || "-",
              city: edits.city.trim() || "-",
              insurance_status: edits.insurance.trim() || "-",
            }
          : {}),
      },
      "Patient updated",
    );
  }

  async function handleAddNote() {
    if (!lead || !note.trim()) return;
    setSavingNote(true);
    const response = await addLeadActivity({ lead_id: lead.id, action_type: "note", description: note.trim() });
    setSavingNote(false);
    if (!response.success) {
      toast.add({ title: "Could not save note", description: response.error, type: "error" });
      return;
    }
    setActivities((current) => [response.data, ...current]);
    setNote("");
    toast.add({ title: "Note added" });
  }

  async function handleLogCall() {
    if (!lead) return;
    setSaving(true);
    const response = await logLeadCall({
      lead_id: lead.id,
      outcome: callDraft.outcome,
      notes: callDraft.notes.trim() || null,
      next_follow_up_date: callDraft.nextDate || null,
    });
    setSaving(false);
    if (!response.success) {
      toast.add({ title: "Could not log call", description: response.error, type: "error" });
      return;
    }
    setActivities((current) => [response.data, ...current]);
    setCallDraft(emptyCallDraft());
    toast.add({ title: "Call logged" });
  }

  if (!open) return null;

  const ActiveActivity = loadingActivities ? (
    <p className="flex items-center gap-2 text-sm text-slate-500">
      <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading activity…
    </p>
  ) : activities.length === 0 ? (
    <p className="text-sm text-slate-500">No activity yet — add the first note from the Info tab.</p>
  ) : (
    <div className="space-y-4 border-l border-slate-200 pl-4">
      {activities.map((activity) => (
        <article key={activity.id} className="relative space-y-1">
          <span className="absolute -left-[1.35rem] top-1 size-2 rounded-full bg-slate-400 ring-4 ring-white" />
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
            {activity.action_type === "call" ? (
              <PhoneCall className="size-3.5" aria-hidden="true" />
            ) : activity.action_type === "note" ? (
              <MessageSquareText className="size-3.5" aria-hidden="true" />
            ) : activity.action_type === "follow_up" ? (
              <CalendarDays className="size-3.5" aria-hidden="true" />
            ) : (
              <TimerReset className="size-3.5" aria-hidden="true" />
            )}
            {activity.action_type}
          </p>
          <p className="text-sm text-slate-700">{activity.description || "No details provided."}</p>
          <p className="text-[11px] text-slate-400">
            {new Date(activity.created_at).toLocaleString("en-IN", {
              day: "numeric",
              month: "short",
              hour: "numeric",
              minute: "2-digit",
            })}
          </p>
        </article>
      ))}
    </div>
  );

  const ActiveCall = (
    <div className="space-y-3">
      <div>
        <Label htmlFor="drawer-call-outcome">Call outcome</Label>
        <Select
          value={callDraft.outcome}
          onValueChange={(value) =>
            setCallDraft((current) => ({ ...current, outcome: value ?? current.outcome }))
          }
        >
          <SelectTrigger id="drawer-call-outcome">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OUTCOME_OPTIONS.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="drawer-call-notes">Notes</Label>
        <Textarea
          id="drawer-call-notes"
          rows={3}
          value={callDraft.notes}
          placeholder="What did the patient say?"
          onChange={(event) => setCallDraft((current) => ({ ...current, notes: event.target.value }))}
        />
      </div>
      <div>
        <Label htmlFor="drawer-call-next">Next follow-up (optional)</Label>
        <Input
          id="drawer-call-next"
          type="date"
          value={callDraft.nextDate}
          onChange={(event) => setCallDraft((current) => ({ ...current, nextDate: event.target.value }))}
        />
      </div>
      <Button type="button" className="w-full" onClick={() => void handleLogCall()} disabled={saving}>
        {saving ? "Saving…" : "Save call"}
      </Button>
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{lead ? lead.name : "Patient"}</SheetTitle>
          {title && <p className="text-xs text-slate-500">{title}</p>}
        </SheetHeader>

        {loading && (
          <p className="flex items-center gap-2 py-10 text-sm text-slate-500">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading…
          </p>
        )}

        {!loading && lead && (
          <div className="mt-4 space-y-5">
            <div className="flex items-center gap-1.5 rounded-xl bg-slate-100 p-1">
              {tabButton("info", "Info")}
              {tabButton("activity", "Activity")}
              {tabButton("call", "Log Call")}
            </div>

              {(activeTab as string) === "info" ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <Label htmlFor="drawer-detail-name">Name</Label>
                    <Input
                      id="drawer-detail-name"
                      value={edits.name}
                      onChange={(event) => setEdits((current) => ({ ...current, name: event.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="drawer-detail-phone">Phone</Label>
                    <Input
                      id="drawer-detail-phone"
                      inputMode="tel"
                      value={edits.phone}
                      onChange={(event) => setEdits((current) => ({ ...current, phone: event.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="drawer-detail-email">Email</Label>
                    <Input
                      id="drawer-detail-email"
                      type="email"
                      value={edits.email}
                      disabled={!canEditCore}
                      onChange={(event) => setEdits((current) => ({ ...current, email: event.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="drawer-detail-gender">Gender</Label>
                    <Input
                      id="drawer-detail-gender"
                      value={edits.gender}
                      disabled={!canEditCore}
                      onChange={(event) => setEdits((current) => ({ ...current, gender: event.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="drawer-detail-city">City / Area</Label>
                    <Input
                      id="drawer-detail-city"
                      value={edits.city}
                      disabled={!canEditCore}
                      onChange={(event) => setEdits((current) => ({ ...current, city: event.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="drawer-detail-insurance">Insurance Status</Label>
                    <Input
                      id="drawer-detail-insurance"
                      value={edits.insurance}
                      disabled={!canEditCore}
                      onChange={(event) => setEdits((current) => ({ ...current, insurance: event.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="drawer-detail-stage">Stage</Label>
                    <Select
                      value={edits.status}
                      onValueChange={(value) =>
                        setEdits((current) => ({ ...current, status: value ?? current.status }))
                      }
                    >
                      <SelectTrigger id="drawer-detail-stage">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-72 overflow-y-auto">
                        {withCurrentValue(masterStatuses, edits.status).map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    {/* Temperature is one of the fields employees may change. */}
                    <Label htmlFor="drawer-detail-temp">Temperature</Label>
                    <Select
                      value={edits.temperature || "unset"}
                      onValueChange={(value) =>
                        setEdits((current) => ({
                          ...current,
                          temperature: value === "unset" ? "" : (value ?? ""),
                        }))
                      }
                    >
                      <SelectTrigger id="drawer-detail-temp">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-72 overflow-y-auto">
                        <SelectItem value="unset">Not set</SelectItem>
                        {withCurrentValue(masterTemperatures, edits.temperature).map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Label htmlFor="drawer-detail-treatment">Treatment / Disease</Label>
                    <Input
                      id="drawer-detail-treatment"
                      value={edits.treatment}
                      placeholder="For example: LASIK, Cataract"
                      onChange={(event) => setEdits((current) => ({ ...current, treatment: event.target.value }))}
                    />
                  </div>
                  <div className="col-span-2">
                    <Label htmlFor="drawer-detail-followup">Next follow-up</Label>
                    <Input
                      id="drawer-detail-followup"
                      type="date"
                      value={edits.followUpDate}
                      onChange={(event) => setEdits((current) => ({ ...current, followUpDate: event.target.value }))}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  {/* City / temperature are editable inputs above, so only the
                      read-only facts are repeated here. */}
                  <p className="rounded-lg bg-slate-50 px-2.5 py-2 text-slate-600">Source: {lead.source}</p>
                  <p className="rounded-lg bg-slate-50 px-2.5 py-2 text-slate-600">Agent: {lead.assigned_to}</p>
                  {/* Same helper as the leads table, so both always agree. */}
                  <p className="col-span-2 rounded-lg bg-slate-50 px-2.5 py-2 text-slate-600">
                    {relativeLeadAge(lead.created_at) ?? "Added: -"}
                  </p>
                </div>

                <Button type="button" className="w-full" onClick={() => void handleInfoSave()} disabled={saving}>
                  {saving ? "Saving…" : "Save changes"}
                </Button>

                <div>
                  <Label htmlFor="drawer-detail-note">Quick note</Label>
                  <div className="mt-1 flex gap-2">
                    <Input
                      id="drawer-detail-note"
                      value={note}
                      placeholder="What happened in this follow-up…"
                      onChange={(event) => setNote(event.target.value)}
                    />
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void handleAddNote()}
                      disabled={savingNote || !note.trim()}
                    >
                      {savingNote ? "…" : "Add"}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">{activeTab === "activity" ? ActiveActivity : ActiveCall}</div>
            )}
          </div>
        )}

        {!loading && !lead && (
          <div className="space-y-3 py-10 text-center">
            <X className="mx-auto size-6 text-slate-300" aria-hidden="true" />
            <p className="text-sm text-slate-500">Could not open this lead. Tap again.</p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
