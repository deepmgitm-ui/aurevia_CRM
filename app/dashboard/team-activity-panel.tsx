"use client";

import { useEffect, useState } from "react";
import { getStaffActivity } from "@/app/actions/team-activity";
import {
  activityDuration,
  activityState,
  type StaffActivity,
} from "@/lib/team-activity";
import { clinicDate } from "@/lib/attendance";
import { Button } from "@/components/ui/button";

export function TeamActivityPanel({
  day,
  own = false,
}: {
  day?: string;
  own?: boolean;
}) {
  const [rows, setRows] = useState<StaffActivity[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [trackingError, setTrackingError] = useState(false);
  const targetDay = day || clinicDate();
  useEffect(() => {
    let cancelled = false;
    let pending = false;
    let firstHeartbeat = false;
    let queued = false;
    let snapshotDay: string | undefined;
    async function load() {
      if (pending || document.visibilityState !== "visible") return;
      pending = true;
      try {
        if (!navigator.onLine) {
          await Promise.resolve();
          if (!cancelled)
            setError("You are offline. Displayed activity may be out of date.");
          return;
        }
        const result = await getStaffActivity(targetDay);
        if (cancelled) return;
        if (result.success) {
          if (result.data[0]?.observed_at)
            snapshotDay = clinicDate(new Date(result.data[0].observed_at));
          setRows(result.data);
          setError("");
        } else setError(result.error);
      } catch {
        if (!cancelled) setError("Activity could not be loaded. Please retry.");
      } finally {
        pending = false;
        if (!cancelled) setLoading(false);
        if (queued && !cancelled) {
          queued = false;
          void load();
        }
      }
    }
    const visible = () => {
      if (document.visibilityState === "visible") void load();
    };
    const health = (event: Event) => {
      const success = (event as CustomEvent<boolean>).detail;
      setTrackingError(!success);
      if (
        success &&
        !firstHeartbeat &&
        (!snapshotDay || targetDay === snapshotDay)
      ) {
        firstHeartbeat = true;
        if (pending) queued = true;
        else void load();
      }
    };
    const offline = () => {
      setError("You are offline. Displayed activity may be out of date.");
      setLoading(false);
    };
    void load();
    const timer = setInterval(() => {
      if (!snapshotDay || targetDay === snapshotDay) void load();
    }, 60_000);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("crm:activity-health", health);
    window.addEventListener("offline", offline);
    window.addEventListener("online", visible);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", visible);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("crm:activity-health", health);
    };
  }, [targetDay, revision]);
  const snapshotDay = rows[0]?.observed_at
    ? clinicDate(new Date(rows[0].observed_at))
    : targetDay;
  const historical = targetDay !== snapshotDay;
  const now = rows[0]?.observed_at ? Date.parse(rows[0].observed_at) : 0;
  const counts = rows.reduce(
    (result, row) => {
      result[activityState(row, now)]++;
      return result;
    },
    { Active: 0, Idle: 0, Offline: 0 },
  );
  return (
    <section
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      aria-label={own ? "My CRM activity" : "Team activity"}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            {own ? "My CRM activity" : "Team activity"}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            {targetDay} · IST · Updates about every minute
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setRevision((value) => value + 1)}
        >
          Refresh
        </Button>
      </div>
      {!historical && !loading && !error && (
        <div className="flex flex-wrap gap-2 text-xs">
          {Object.entries(counts).map(([state, count]) => (
            <span
              key={state}
              className="rounded-full bg-slate-100 px-3 py-1.5 font-medium"
            >
              {count} {state}
            </span>
          ))}
        </div>
      )}
      <p className="text-xs text-slate-500">
        Active means recent CRM interaction within 5 minutes; idle means the CRM
        is open without recent interaction. Offline means no update for over 2½
        minutes. Durations estimate CRM usage, not attendance or completed
        calls.
      </p>
      {loading && (
        <p role="status" className="text-sm text-slate-500">
          Loading activity…
        </p>
      )}
      {(error || trackingError) && (
        <p
          role="alert"
          className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800"
        >
          {error ||
            "Your activity update could not be saved. Connection will be retried automatically."}
        </p>
      )}
      {!loading && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => {
            const state = activityState(row, now);
            const stale = Boolean(error);
            const color =
              state === "Active"
                ? "bg-emerald-100 text-emerald-800"
                : state === "Idle"
                  ? "bg-amber-100 text-amber-800"
                  : "bg-slate-100 text-slate-600";
            return (
              <article
                key={row.user_id}
                className="rounded-xl border border-slate-200 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{row.name}</p>
                    <p className="text-xs capitalize text-slate-500">
                      {row.role}
                    </p>
                  </div>
                  {!historical && (
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${stale ? "bg-slate-100 text-slate-500" : color}`}
                    >
                      {stale ? "Status unavailable" : state}
                    </span>
                  )}
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <dt className="text-xs text-slate-500">
                      Active {historical ? "on this date" : "today"}
                    </dt>
                    <dd className="mt-1 text-xl font-semibold tabular-nums">
                      {row.active_seconds
                        ? activityDuration(row.active_seconds)
                        : "0m"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">
                      CRM open {historical ? "on this date" : "today"}
                    </dt>
                    <dd className="mt-1 text-xl font-semibold tabular-nums">
                      {row.online_seconds
                        ? activityDuration(row.online_seconds)
                        : "0m"}
                    </dd>
                  </div>
                </dl>
                {!historical &&
                  state !== "Offline" &&
                  !stale &&
                  row.session_started_at && (
                    <p className="mt-3 text-xs text-slate-600">
                      Current session:{" "}
                      {activityDuration(
                        Math.max(
                          0,
                          (Date.parse(row.last_seen!) -
                            Date.parse(row.session_started_at)) /
                            1000,
                        ),
                      )}
                    </p>
                  )}
                <p className="mt-2 text-xs text-slate-500">
                  Last seen:{" "}
                  {row.last_seen
                    ? new Date(row.last_seen).toLocaleString("en-IN", {
                        timeZone: "Asia/Kolkata",
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      }) + " IST"
                    : "Not recorded yet"}
                </p>
              </article>
            );
          })}
        </div>
      )}
      {!loading && !error && rows.length === 0 && (
        <p className="text-sm text-slate-500">No activity records available.</p>
      )}
    </section>
  );
}
