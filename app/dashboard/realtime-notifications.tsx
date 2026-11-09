"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, ExternalLink } from "lucide-react";

import { getViewer } from "@/app/actions/leads";
import { createClient } from "@/lib/supabase/client";

type Notification = {
  id: string;
  lead_id: string | null;
  event_type: "lead_created" | "lead_updated" | "lead_assignment";
  title: string;
  message: string;
  created_at: string;
};

const PAGE_SIZE = 50;

export function RealtimeNotifications() {
  const router = useRouter();
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const loadNotifications = useCallback(async (userId: string) => {
    const supabase = createClient();
    const [{ data, error: listError }, { count, error: countError }] = await Promise.all([
      supabase
        .from("crm_notifications")
        .select("id, lead_id, event_type, title, message, created_at")
        .eq("recipient_id", userId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(PAGE_SIZE),
      supabase.from("crm_notifications").select("id", { count: "exact", head: true }).eq("recipient_id", userId),
    ]);
    if (listError || countError) {
      setError("Notifications could not be loaded. Refresh to try again.");
      return;
    }
    setError("");
    setNotifications((current) => {
      const live = current.filter((item) => (data ?? []).some((row) => row.id === item.id));
      const known = new Set(live.map((item) => item.id));
      return [...live, ...(data ?? []).filter((row) => !known.has(row.id) && row.created_at).map((row) => row as Notification)]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, PAGE_SIZE);
    });
    setUnreadCount(count ?? 0);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let supabase: ReturnType<typeof createClient> | null = null;
    let channel: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null;
    let userId: string | null = null;

    async function start() {
      const result = await getViewer();
      const viewer = result.success ? result.data : null;
      if (cancelled || !viewer) return;
      userId = viewer.id;
      setViewerId(viewer.id);
      supabase = createClient();
      channel = supabase
        .channel(`crm-notifications-${viewer.id}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "crm_notifications", filter: `recipient_id=eq.${viewer.id}` },
          (payload) => {
            const row = payload.new as Notification;
            if (!row?.id) return;
            setNotifications((current) => current.some((item) => item.id === row.id)
              ? current
              : [row, ...current].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, PAGE_SIZE));
            setUnreadCount((count) => count + 1);
            if (row.lead_id) {
              window.dispatchEvent(new Event("crm:leads-changed"));
              router.refresh();
            }
          },
        )
        .subscribe();
      await loadNotifications(viewer.id);
    }

    void start();
    const onVisible = () => {
      if (document.visibilityState === "visible" && userId) void loadNotifications(userId);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (supabase && channel) void supabase.removeChannel(channel);
    };
  }, [loadNotifications, router]);

  async function markRead(id: string) {
    if (!viewerId || busyId) return;
    setBusyId(id);
    setError("");
    const { error: deleteError } = await createClient()
      .from("crm_notifications")
      .delete()
      .eq("id", id)
      .eq("recipient_id", viewerId);
    setBusyId(null);
    if (deleteError) {
      setError("This notification could not be cleared. Please try again.");
      return;
    }
    setNotifications((current) => current.filter((item) => item.id !== id));
    setUnreadCount((count) => Math.max(0, count - 1));
  }

  async function markAllRead() {
    if (!viewerId || busyId) return;
    setBusyId("all");
    setError("");
    const { error: deleteError } = await createClient()
      .from("crm_notifications")
      .delete()
      .eq("recipient_id", viewerId);
    setBusyId(null);
    if (deleteError) {
      setError("Notifications could not be cleared. Please try again.");
      return;
    }
    setNotifications([]);
    setUnreadCount(0);
  }

  if (!viewerId) return null;

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}
        aria-expanded={isOpen}
        aria-controls="crm-notification-panel"
        title="Notifications"
        className="relative rounded-full p-2 text-slate-500 transition-colors hover:bg-emerald-50 hover:text-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
        onClick={() => setIsOpen((open) => !open)}
      >
        <Bell className="size-5" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-emerald-700 px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-white" aria-hidden="true">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <section id="crm-notification-panel" aria-label="Unread notifications" className="absolute right-0 top-12 z-50 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-emerald-900/10 bg-white shadow-xl">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Notifications</h2>
              <p className="text-xs text-slate-500">Unread items stay here until you clear them.</p>
            </div>
            {unreadCount > 0 && <button type="button" disabled={busyId !== null} onClick={() => void markAllRead()} className="min-h-9 rounded-md px-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 disabled:opacity-50">Mark all read</button>}
          </div>
          {error && <p role="alert" className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-xs text-rose-800">{error}</p>}
          <div className="max-h-[min(24rem,65vh)] overflow-y-auto" aria-live="polite">
            {notifications.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">You’re all caught up.</p>
            ) : notifications.map((item) => (
              <article key={item.id} className="border-b border-slate-100 px-4 py-3 last:border-b-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium text-slate-900">{item.title}</h3>
                    <p className="mt-0.5 text-sm leading-5 text-slate-600">{item.message}</p>
                    <time className="mt-1 block text-xs text-slate-400" dateTime={item.created_at}>{new Date(item.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</time>
                  </div>
                  <button type="button" aria-label="Mark notification as read" title="Mark as read" disabled={busyId !== null} onClick={() => void markRead(item.id)} className="shrink-0 rounded-md p-2 text-emerald-800 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 disabled:opacity-50"><Check className="size-4" aria-hidden="true" /></button>
                </div>
                {item.lead_id && <button type="button" onClick={() => { setIsOpen(false); router.push(`/dashboard/leads?openLead=${encodeURIComponent(item.lead_id!)}`); }} className="mt-2 inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-emerald-800 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"><ExternalLink className="size-3.5" aria-hidden="true" />Open lead</button>}
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
