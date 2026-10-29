"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";

import { getMyAssignedLeadCount, getViewer } from "@/app/actions/leads";
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
  const router = useRouter();
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
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let assignmentCountInterval: ReturnType<typeof setInterval> | null = null;
    let lastRefresh = 0;
    function refreshOnce() {
      if(refreshTimer || document.visibilityState !== "visible") return;
      refreshTimer=setTimeout(()=>{refreshTimer=null;if(document.querySelector('[role="dialog"]')){refreshOnce();return;}lastRefresh=Date.now();window.dispatchEvent(new Event("crm:leads-changed"));router.refresh();},1500);
    }
    const onVisible=()=>{if(document.visibilityState === "visible" && Date.now()-lastRefresh>30000) refreshOnce();};
    document.addEventListener("visibilitychange",onVisible);
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

      if (isEmployee) {
        let previousCount: number | null = null;
        const syncAssignmentCount = async () => {
          if (cancelled || document.visibilityState !== "visible") return;
          const result = await getMyAssignedLeadCount();
          if (cancelled || !result.success) return;
          if (previousCount !== null && result.data !== previousCount) refreshOnce();
          previousCount = result.data;
        };
        void syncAssignmentCount();
        assignmentCountInterval = setInterval(() => void syncAssignmentCount(), 60_000);
      }

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

        // One summary per burst, even when it contains a mix of inserts,
        // edits and assignments. Direct table actions already confirm saves.
        if (isAdminUser) {
          const assigned = batched.assignments.length;
          const updated = batched.updates.length;
          const summary = [
            batched.inserts.length ? `${batched.inserts.length} added` : "",
            assigned ? `${assigned} assigned` : "",
            updated ? `${updated} updated` : "",
          ].filter(Boolean).join(" · ");
          if (summary) toast.add({ title: "Team activity", description: summary, type: "success" });
        } else if (batched.assignedToYou > 0) {
          toast.add({
            title: "New leads assigned",
            description: `${batched.assignedToYou} lead${batched.assignedToYou === 1 ? " was" : "s were"} assigned to you.`,
            type: "success",
          });
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
          { event: "INSERT", schema: "public", table: "leads", ...(isEmployee ? {filter:`assigned_to=eq.${viewerName}`} : {}) },
          (payload: { new?: LeadPayload }) => {
            const row = payload.new ?? {};
            const leadId = asText(row.id);
            if (!leadId) return;
            if(!isRecentSelfMutation(leadId)) refreshOnce();
            const who = asText(row.assigned_to);
            const leadName = asText(row.name);
            const whoLabel = who && who !== "-" ? who : null;

            // Smart employee alert: a new lead arrived already assigned to ME.
            if (isEmployee) {
              if (whoLabel && whoLabel === viewerName) queueAssignedToYou();
              return;
            }

            const self = isRecentSelfMutation(leadId);
            // Add/import flows show their own single result summary.
            if (self) return;

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
          { event: "UPDATE", schema: "public", table: "leads", ...(isEmployee ? {filter:`assigned_to=eq.${viewerName}`} : {}) },
          (payload: { old?: LeadPayload; new?: LeadPayload }) => {
            const newRow = payload.new ?? {};
            const oldRow = payload.old ?? {};
            const leadId = asText(newRow.id);
            if (!leadId) return;
            if(!isRecentSelfMutation(leadId)) refreshOnce();
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

            const self = isRecentSelfMutation(leadId);
            if (self) return;

            if (assignmentChanged) {
              queue("assignment", {
                id: `ASSIGNMENT-${leadId}-${Date.now()}-${Math.random()}`,
                type: "ASSIGNMENT",
                message: `Lead assigned to ${newAssigned && newAssigned !== "-" ? newAssigned : "Unassigned"}${patientSuffix}`,
                at: Date.now(),
              });
              return;
            }

            queue("update", {
              id: `UPDATE-${leadId}-${Date.now()}-${Math.random()}`,
              type: "UPDATE",
              message: `A teammate updated a lead${patientSuffix}.`,
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
      document.removeEventListener("visibilitychange",onVisible);
      if(refreshTimer) clearTimeout(refreshTimer);
      if(assignmentCountInterval) clearInterval(assignmentCountInterval);
      if(pendingRef.current.timer) clearTimeout(pendingRef.current.timer);
      if (supabase && channel) void supabase.removeChannel(channel);
    };
  }, [router]);

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
