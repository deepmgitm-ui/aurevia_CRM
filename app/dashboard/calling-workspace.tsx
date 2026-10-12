"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { logLeadCall, type Lead } from "@/app/actions/leads";
import { trackLeadMutations } from "./lead-mutation-tracker";
import { CALL_OUTCOMES } from "@/lib/calls";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
export function CallingWorkspace({ leads }: { leads: Lead[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false),
    [index, setIndex] = useState(0),
    [outcome, setOutcome] = useState("Connected"),
    [notes, setNotes] = useState(""),
    [date, setDate] = useState(""),
    [time, setTime] = useState(""),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false),
    lead = leads[index];
  function next() {
    setNotes("");
    setDate("");
    setTime("");
    setOutcome("Connected");
    setError("");
    if (index + 1 < leads.length) setIndex(index + 1);
    else {
      setOpen(false);
      window.dispatchEvent(new Event("crm:leads-changed"));
      router.refresh();
      toast.add({
        title: "Calling page complete",
        description: "Open the next Leads page to continue your queue.",
      });
    }
  }
  async function save() {
    if (!lead || lock.current) return;
    lock.current = true;
    trackLeadMutations(lead.id);
    setPending(true);
    setError("");
    try {
      const result = await logLeadCall({
        lead_id: lead.id,
        outcome,
        notes,
        next_follow_up_date: date || null,
        next_follow_up_time: time || null,
      });
      if (result.success) {
        toast.add({ title: "Call saved" });
        next();
      } else setError(result.error);
    } catch {
      setError("Call could not be saved. Please retry.");
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!pending) setOpen(value);
      }}
    >
      <Button
        disabled={!leads.length}
        onClick={() => {
          setIndex(0);
          setError("");
          setOpen(true);
        }}
      >
        Start Calling
      </Button>
      {open && lead && (
        <DialogContent showCloseButton={!pending}>
          <DialogHeader>
            <DialogTitle>
              Calling · {index + 1} / {leads.length} on this page
            </DialogTitle>
          </DialogHeader>
          <h3 className="text-lg font-semibold">{lead.name}</h3>
          <p className="text-sm text-slate-500">
            {lead.status} · {lead.assigned_to}
          </p>
          {lead.phone && lead.phone !== "-" && (
            <a
              className="rounded-lg bg-blue-50 p-3 font-semibold text-blue-700"
              href={`tel:${lead.phone}`}
            >
              Call {lead.phone}
            </a>
          )}
          <fieldset disabled={pending} className="space-y-3">
            <label className="block text-sm">
              Call outcome
              <select
                className="mt-1 w-full rounded-lg border p-2"
                value={outcome}
                onChange={(event) => setOutcome(event.target.value)}
              >
                {CALL_OUTCOMES.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              Call notes
              <textarea
                className="mt-1 w-full rounded-lg border p-2"
                rows={3}
                maxLength={5000}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">
                Callback date
                <Input
                  type="date"
                  value={date}
                  onChange={(event) => {
                    setDate(event.target.value);
                    if (!event.target.value) setTime("");
                  }}
                />
              </label>
              <label className="text-sm">
                Time (IST)
                <Input
                  type="time"
                  disabled={!date}
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                />
              </label>
            </div>
          </fieldset>
          {error && (
            <p role="alert" className="text-sm text-rose-700">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={pending} onClick={next}>
              Skip
            </Button>
            <Button disabled={pending} onClick={() => void save()}>
              {pending ? "Saving..." : "Save & Next Lead"}
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
