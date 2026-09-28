// Aurevia CRM — the full journey of ONE lead, oldest first. Opened from any
// lead chip on the calendar so "lead kab aaya → follow-up kab laga → call kab
// hui → status kab badla" sab ek hi jagah, apni-apni date ke saath dikhe.
"use client";

import { useEffect, useState } from "react";

import {
  BadgeCheck,
  CalendarDays,
  MessageSquareText,
  PhoneCall,
  Sparkles,
  TimerReset,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getLeadTimeline, type LeadTimeline } from "./actions";

const ACTION_LABELS: Record<string, string> = {
  created: "Lead added",
  status: "Status change",
  note: "Note added",
  call: "Call logged",
  follow_up: "Follow-up set",
  follow_up_done: "Follow-up done",
  plan: "Scheduled from calendar",
};

function actionLabel(actionType: string): string {
  return ACTION_LABELS[actionType] ?? actionType.replace(/_/g, " ");
}

function ActionIcon({ actionType }: { actionType: string }) {
  const className = "size-3.5";
  if (actionType === "created") return <Sparkles className={`${className} text-emerald-600`} aria-hidden="true" />;
  if (actionType === "call") return <PhoneCall className={`${className} text-amber-600`} aria-hidden="true" />;
  if (actionType === "note") return <MessageSquareText className={`${className} text-sky-600`} aria-hidden="true" />;
  if (actionType === "follow_up_done") return <BadgeCheck className={`${className} text-green-600`} aria-hidden="true" />;
  if (actionType === "follow_up") return <CalendarDays className={`${className} text-blue-600`} aria-hidden="true" />;
  return <TimerReset className={`${className} text-slate-500`} aria-hidden="true" />;
}

export function LeadTimelineDialog({
  leadId,
  open,
  onOpenChange,
}: {
  leadId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Cache-key pattern: every async result lands in one `cache` object tagged
  // with the lead it belongs to, so loading is DERIVED (no setState in effect).
  const [cache, setCache] = useState<{
    leadId: string;
    timeline: LeadTimeline | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (!open || !leadId) return;
    let active = true;
    void getLeadTimeline(leadId).then((response) => {
      if (!active) return;
      setCache({
        leadId,
        timeline: response.success ? (response.data ?? null) : null,
        error: response.success ? null : (response.error ?? "Timeline load nahi ho paya."),
      });
    });
    return () => {
      active = false;
    };
  }, [open, leadId]);

  const current = cache && cache.leadId === leadId ? cache : null;
  const loading = open && !!leadId && !current;
  const timeline = current?.timeline ?? null;
  const error = current?.error ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{timeline ? timeline.leadName : "Lead timeline"}</DialogTitle>
        </DialogHeader>

        {loading && <p className="py-6 text-center text-sm text-slate-500">Loading…</p>}
        {!loading && error && <p className="py-6 text-center text-sm text-rose-600">{error}</p>}

        {!loading && !error && timeline && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-1.5 text-xs text-slate-500">
              <Badge variant="secondary">{timeline.status}</Badge>
              <span>Phone: {timeline.phone}</span>
              <span>· Source: {timeline.source}</span>
              {timeline.city !== "-" && <span>· {timeline.city}</span>}
              {timeline.disease !== "-" && <span>· {timeline.disease}</span>}
              {timeline.assignedTo !== "-" && <span>· {timeline.assignedTo}</span>}
            </div>
            {timeline.followUpDate && (
              <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700">
                Agla follow-up: {timeline.followUpDate}
              </p>
            )}

            <ol className="relative space-y-3 border-l border-slate-200 pl-4">
              {timeline.items.length === 0 && (
                <li className="text-sm text-slate-500">Abhi koi activity record nahi hui.</li>
              )}
              {timeline.items.map((item) => (
                <li key={item.id} className="relative">
                  <span className="absolute -left-[22px] mt-0.5 flex size-4 items-center justify-center rounded-full bg-white ring-1 ring-slate-200">
                    <ActionIcon actionType={item.actionType} />
                  </span>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-sm font-semibold text-slate-900">{actionLabel(item.actionType)}</span>
                    <span className="text-xs text-slate-400">
                      {new Date(item.date + "T00:00:00").toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                  </div>
                  {item.description && <p className="text-xs text-slate-600">{item.description}</p>}
                </li>
              ))}
            </ol>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
