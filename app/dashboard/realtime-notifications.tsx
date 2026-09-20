"use client";

import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";

import { getViewer } from "@/app/actions/leads";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/ui/toast";
import { isRecentSelfMutation } from "./lead-mutation-tracker";

interface ActivityEvent {
  id: string;
  type: "INSERT" | "UPDATE" | "ASSIGNMENT";
  message: string;
  detail?: string;
  at: number;
}

interface LeadPayload {
  id?: unknown;
  name?: unknown;
  assigned_to?: unknown;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Events arriving in a burst (e.g. a bulk import) are batched into a single
// toast within this window instead of spamming one toast per row.
const BATCH_WINDOW_MS = 1_000;

// Role-aware realtime notifications driven by postgres_changes on public.leads:
// - Admins: team activity (teammates adding/updating leads), silence for their
//   own general actions, EXCEPT a "✅ Lead successfully assigned" confirmation
//   when their own INSERT/UPDATE assigns a lead to an employee.
// - Employees: only "🔔 A new lead has been assigned to you!" when the
//   assigned_to field changes to (or arrives as) their own name.
// Notification bell + activity dropdown are rendered for admins only.
export function RealtimeNotifications() {
  const [isActive, setIsActive] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  // Events arriving in a burst (e.g. a bulk import) are batched into a single
  // toast instead of spamming one toast per row.
  const pendingRef = useRef<{
    inserts: ActivityEvent[];
    updates: ActivityEvent[];
    assignments: ActivityEvent[];
    assignedToYou: number;
    timer: ReturnType<typeof setTimeout> | null;
  }>({ inserts: [], updates: [], assignments: [], assignedToYou: 0, timer: null });

  useEffect(() => {
    let cancelled = false;
    type RealtimeClient = ReturnType<typeof createClient>;
    type RealtimeChannel = ReturnType<RealtimeClient["channel"]>;
    let supabase: RealtimeClient | null = null;
    let channel: RealtimeChannel | null = null;

    async function start() {
      const viewerResult = await getViewer();
      const viewer = viewerResult.success ? viewerResult.data : null;
      // Role-aware notifications: admins get team activity, employees get
      // assignment alerts. The bell UI itself stays admin-only.
      if (!viewer) return;
      if (cancelled) return;

      const role = viewer.role;
      const viewerName = viewer.name;
      const isEmployee = role === "employee";
      const isAdminUser = role === "admin";

      supabase = createClient();

      function pushActivity(events: ActivityEvent[]) {
        if (!isAdminUser) return; // bell/dropdown is an admin affordance
        setActivity((current) => [...events, ...current].slice(0, 25));
        setUnreadCount((count) => count + events.length);
      }

      function flushBatch() {
        const batched = pendingRef.current;
        pendingRef.current = { inserts: [], updates: [], assignments: [], assignedToYou: 0, timer: null };
        pushActivity([...batched.inserts, ...batched.updates, ...batched.assignments]);

        // Admin: new leads added by teammates (never the admin themselves).
        if (batched.inserts.length === 1) {
          toast.add({ title: `🔔 ${batched.inserts[0].message}`, type: "success" });
        } else if (batched.inserts.length > 1) {
          toast.add({ title: `🔔 ${batched.inserts.length} new leads added!`, type: "success" });
        }

        // Admin: leads updated by teammates (assignment info when changed).
        if (batched.updates.length === 1) {
          toast.add({
            title: `📝 ${batched.updates[0].message}`,
            description: batched.updates[0].detail || undefined,
            type: "info",
          });
        } else if (batched.updates.length > 1) {
          toast.add({ title: `📝 ${batched.updates.length} leads were updated!`, type: "info" });
        }

        // Admin: assignment confirmations — INCLUDING the admin's own actions.
        if (batched.assignments.length === 1) {
          toast.add({ title: `✅ ${batched.assignments[0].message}`, type: "success" });
        } else if (batched.assignments.length > 1) {
          toast.add({ title: `✅ ${batched.assignments.length} leads successfully assigned!`, type: "success" });
        }

        // Employee: leads assigned to me.
        if (batched.assignedToYou === 1) {
          toast.add({ title: "🔔 A new lead has been assigned to you!", type: "success" });
        } else if (batched.assignedToYou > 1) {
          toast.add({ title: `🔔 ${batched.assignedToYou} new leads have been assigned to you!`, type: "success" });
        }
      }

      function queue(kind: "insert" | "update" | "assignment", event: ActivityEvent) {
        const pending = pendingRef.current;
        if (kind === "insert") pending.inserts.push(event);
        else if (kind === "update") pending.updates.push(event);
        else pending.assignments.push(event);
        if (!pending.timer) {
          pending.timer = setTimeout(flushBatch, BATCH_WINDOW_MS);
        }
      }

      function queueAssignedToYou() {
        const pending = pendingRef.current;
        pending.assignedToYou += 1;
        if (!pending.timer) {
          pending.timer = setTimeout(flushBatch, BATCH_WINDOW_MS);
        }
      }

      channel = supabase
        .channel("leads-realtime-notifications")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "leads" },
          (payload: { new?: LeadPayload }) => {
            const row = payload.new ?? {};
            const leadId = asText(row.id);
            if (!leadId) return;
            const who = asText(row.assigned_to);
            const leadName = asText(row.name);
            const whoLabel = who && who !== "-" ? who : null;

            // Smart employee alert: a new lead arrived already assigned to ME.
            if (isEmployee) {
              if (whoLabel && whoLabel === viewerName) queueAssignedToYou();
              return;
            }

            const self = isRecentSelfMutation(leadId);
            if (self) {
              // EXCEPTION: the admin's own INSERT assigned the lead to an
              // employee → assignment confirmation. Other self-INSERTs stay silent.
              if (isAdminUser && whoLabel) {
                queue("assignment", {
                  id: `ASSIGNMENT-${leadId}-${Date.now()}-${Math.random()}`,
                  type: "ASSIGNMENT",
                  message: `Lead successfully assigned to ${whoLabel}`,
                  at: Date.now(),
                });
              }
              return;
            }

            const suffix = whoLabel ? ` by ${whoLabel}` : "";
            const patientSuffix = leadName && leadName !== "-" ? ` (${leadName})` : "";
            queue("insert", {
              id: `INSERT-${leadId}-${Date.now()}-${Math.random()}`,
              type: "INSERT",
              message: `New lead added${suffix}!${patientSuffix}`,
              at: Date.now(),
            });
          },
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "leads" },
          (payload: { old?: LeadPayload; new?: LeadPayload }) => {
            const newRow = payload.new ?? {};
            const oldRow = payload.old ?? {};
            const leadId = asText(newRow.id);
            if (!leadId) return;
            // Correct old/new comparison to detect assignment changes. Note:
            // payload.old only carries full values with REPLICA IDENTITY FULL.
            const newAssigned = asText(newRow.assigned_to);
            const oldAssigned = asText(oldRow.assigned_to);
            const assignmentChanged = oldAssigned !== newAssigned;
            const patient = asText(newRow.name);
            const patientSuffix = patient && patient !== "-" ? ` (${patient})` : "";

            // Smart employee alert: assigned_to changed and now points at ME.
            if (isEmployee) {
              if (assignmentChanged && newAssigned && newAssigned !== "-" && newAssigned === viewerName) {
                queueAssignedToYou();
              }
              return;
            }

            const actor = newAssigned && newAssigned !== "-" ? newAssigned : "Someone";
            const detail = assignmentChanged
              ? `Assigned to ${newAssigned && newAssigned !== "-" ? newAssigned : "Unassigned"}`
              : undefined;

            const self = isRecentSelfMutation(leadId);
            if (self) {
              // EXCEPTION: the admin's own UPDATE reassigned the lead →
              // confirmation toast. All other self-edits stay silent.
              if (isAdminUser && assignmentChanged && newAssigned && newAssigned !== "-") {
                queue("assignment", {
                  id: `ASSIGNMENT-${leadId}-${Date.now()}-${Math.random()}`,
                  type: "ASSIGNMENT",
                  message: `Lead successfully assigned to ${newAssigned}`,
                  at: Date.now(),
                });
              }
              return;
            }

            // Teammate updated a lead (existing behaviour kept; assignment
            // change surfaced via the toast description).
            queue("update", {
              id: `UPDATE-${leadId}-${Date.now()}-${Math.random()}`,
              type: "UPDATE",
              message: `${actor} updated a lead${patientSuffix}!`,
              detail,
              at: Date.now(),
            });
          },
        )
        .subscribe();

      if (isAdminUser) setIsActive(true);
    }

    void start();

    return () => {
      cancelled = true;
      if (supabase && channel) void supabase.removeChannel(channel);
    };
  }, []);

  if (!isActive) return null;

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Team activity notifications"
        title="Team activity"
        className="relative rounded-full p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
        onClick={() => {
          setIsOpen((open) => !open);
          if (!isOpen) setUnreadCount(0);
        }}
      >
        <Bell className="size-5" aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            className="absolute right-1.5 top-1.5 flex size-2.5 rounded-full bg-red-500 ring-2 ring-white"
            aria-hidden="true"
          />
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-12 z-50 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <p className="border-b border-slate-100 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Team activity
          </p>
          <div className="max-h-72 overflow-y-auto">
            {activity.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-400">No recent activity yet.</p>
            ) : (
              activity.map((event) => (
                <div key={event.id} className="border-b border-slate-50 px-4 py-2.5 last:border-b-0">
                  <p className="text-sm text-slate-700">
                    <span aria-hidden="true">
                      {event.type === "INSERT" ? "🟢" : event.type === "ASSIGNMENT" ? "✅" : "🔵"}
                    </span>{" "}
                    {event.message}
                  </p>
                  {event.detail && <p className="mt-0.5 text-xs text-slate-500">{event.detail}</p>}
                  <p className="mt-0.5 text-xs text-slate-400">
                    {new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}