"use client";
import { useCallback, useEffect, useState } from "react";
import {
  getCapacity,
  getDuplicates,
  getMergeBackup,
  mergeDuplicate,
  setScheduler,
  type DuplicateGroup,
} from "@/app/actions/crm-workflows";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
interface Capacity {
  databaseBytes: number;
  storageBytes: number | null;
  checkedAt: string;
  leads: number;
  staff: number;
  leadBytes: number;
  activityBytes: number;
  appointments: number;
}
export function CrmOperationsPanel({
  capacity,
  scheduler,
  groups,
  total,
  schedulerStatus,
  duplicateError,
}: {
  capacity: Capacity | null;
  scheduler: boolean | null;
  groups: DuplicateGroup[];
  total: number;
  schedulerStatus: {
    startedAt: string | null;
    status: string | null;
    message: string | null;
  } | null;
  duplicateError?: string;
}) {
  const [enabled, setEnabled] = useState(scheduler),
    [pending, setPending] = useState(false),
    [currentCapacity, setCurrentCapacity] = useState(capacity),
    [refreshingCapacity, setRefreshingCapacity] = useState(false),
    [capacityError, setCapacityError] = useState(""),
    [items, setItems] = useState(groups),
    [count, setCount] = useState(total),
    [page, setPage] = useState(1),
    [error, setError] = useState(duplicateError || "");
  async function toggle() {
    if (enabled === null || pending) return;
    setPending(true);
    try {
      if (await setScheduler(!enabled)) setEnabled(!enabled);
      else setError("Schedule setting could not be saved.");
    } catch {
      setError("Schedule setting could not be saved.");
    } finally {
      setPending(false);
    }
  }
  async function load(next = page) {
    setPending(true);
    setError("");
    try {
      const result = await getDuplicates(next);
      if (result.success) {
        setItems(result.data.groups);
        setCount(result.data.total);
        setPage(next);
      } else setError(result.error);
    } catch {
      setError("Duplicate groups could not be loaded.");
    } finally {
      setPending(false);
    }
  }
  const refreshCapacity = useCallback(async () => {
    if (refreshingCapacity) return;
    setRefreshingCapacity(true);
    setCapacityError("");
    try {
      const result = await getCapacity();
      if (result) setCurrentCapacity(result);
      else setCapacityError("Storage usage could not be refreshed. Please retry.");
    } catch {
      setCapacityError("Storage usage could not be refreshed. Please retry.");
    } finally {
      setRefreshingCapacity(false);
    }
  }, [refreshingCapacity]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshCapacity();
    };
    const interval = window.setInterval(refreshWhenVisible, 60_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshCapacity]);
  const databaseLimit = 500 * 1024 * 1024;
  const storageLimit = 1024 * 1024 * 1024;
  const databaseBytes = currentCapacity?.databaseBytes ?? 0;
  const storageBytes = currentCapacity ? currentCapacity.storageBytes : null;
  const remaining = (used: number, limit: number) => Math.max(0, limit - used);
  const formatMb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return (
    <section className="space-y-5 rounded-xl border bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">CRM capacity & operations</h2>
        <Button variant="outline" disabled={refreshingCapacity} onClick={() => void refreshCapacity()}>
          {refreshingCapacity ? "Refreshing…" : "Refresh storage"}
        </Button>
      </div>
      {currentCapacity ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Database", `${formatMb(databaseBytes)} used · ${formatMb(remaining(databaseBytes, databaseLimit))} left`],
              ["File storage", storageBytes === null
                ? "Could not load current usage"
                : `${formatMb(storageBytes)} used · ${formatMb(remaining(storageBytes, storageLimit))} left`],
              ["Team", `${currentCapacity.staff} members · budget target 20`],
              [
                "Records",
                `${currentCapacity.leads.toLocaleString()} leads · ${currentCapacity.appointments.toLocaleString()} appointments`,
              ],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-slate-500">{label}</p>
                <p className="mt-1 font-semibold">{value}</p>
              </div>
            ))}
          </div>
          {(databaseBytes / 1024 / 1024 >= 250 || currentCapacity.staff >= 18) && (
            <p
              role="status"
              className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800"
            >
              Capacity is growing. Review your Supabase Usage dashboard before
              importing large batches or adding more team members.
            </p>
          )}
          <p className="text-xs text-slate-500">
            Usage checked {new Date(currentCapacity.checkedAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })} IST · Auto-refreshes every minute and when you return to this tab. Database and file storage show the Free plan allowances (500 MB and 1 GB); bandwidth and billing usage are separate.
          </p>
          {capacityError && <p role="alert" className="text-sm text-rose-700">{capacityError}</p>}
        </>
      ) : (
        <p role="alert" className="text-sm text-amber-700">
          Capacity could not be loaded. Check database setup or retry.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
        <div>
          <h3 className="font-semibold">Daily automation · 9 AM IST</h3>
          <p className="mt-1 text-xs text-slate-500">
            Runs enabled rules in Supabase, up to 500 matching leads per rule.
            No Vercel scheduled requests. Patient history is kept; operational
            run receipts retain 90 days.
          </p>
        </div>
        <Button
          disabled={pending || enabled === null}
          variant="outline"
          onClick={() => void toggle()}
        >
          {enabled === null
            ? "Unavailable"
            : enabled
              ? "Pause daily automation"
              : "Enable daily automation"}
        </Button>
      </div>
      <p className="text-xs text-slate-500">
        Last scheduled run:{" "}
        {schedulerStatus?.startedAt
          ? `${new Date(schedulerStatus.startedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST · ${schedulerStatus.status}`
          : "No scheduled run recorded yet; check the Supabase Cron job if this continues after 9 AM IST."}
      </p>
      <div className="space-y-3">
        <div className="flex justify-between gap-3">
          <h3 className="font-semibold">Duplicate review · {count} groups</h3>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => void load()}
          >
            Refresh
          </Button>
        </div>
        <p className="text-xs text-slate-500">
          Review matching phone numbers and choose which lead stays. Merging
          preserves activities, appointments, assignment history and an
          admin-only recovery snapshot.
        </p>
        {items.length === 0 && !error ? (
          <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">
            No duplicate groups in this view.
          </p>
        ) : (
          items.map((group) => (
            <DuplicateReview
              key={group.phone}
              group={group}
              onMerged={() => void load()}
            />
          ))
        )}
        {count > 20 && (
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={pending || page <= 1}
              onClick={() => void load(page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              disabled={pending || page * 20 >= count}
              onClick={() => void load(page + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
      )}
    </section>
  );
}
function DuplicateReview({
  group,
  onMerged,
}: {
  group: DuplicateGroup;
  onMerged: () => void;
}) {
  const [targetId, setTargetId] = useState(group.leads[0].id),
    [sourceId, setSourceId] = useState(group.leads[1].id),
    [open, setOpen] = useState(false),
    [confirmation, setConfirmation] = useState(""),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const target = group.leads.find((lead) => lead.id === targetId)!,
    source = group.leads.find((lead) => lead.id === sourceId)!;
  async function merge() {
    if (pending || confirmation !== group.phone) return;
    setPending(true);
    setError("");
    try {
      const result = await mergeDuplicate(target, source, confirmation);
      if (!result.success) {
        setError(result.error);
        return;
      }
      const backup = await getMergeBackup(result.data.backupId);
      if (backup) {
        const url = URL.createObjectURL(
            new Blob([JSON.stringify(backup, null, 2)], {
              type: "application/json",
            }),
          ),
          a = document.createElement("a");
        a.href = url;
        a.download = `crm-merge-recovery-${result.data.backupId}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
      toast.add({
        title: "Duplicates merged",
        description: "Patient history and the recovery record were preserved.",
      });
      setOpen(false);
      onMerged();
    } catch {
      setError(
        "Merge could not be completed. Refresh and review the records again.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="rounded-lg border p-3">
      <p className="font-medium">
        {group.phone} · {group.count} records
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {[
          { label: "Keep this lead", value: targetId, set: setTargetId },
          {
            label: "Merge this lead into it",
            value: sourceId,
            set: setSourceId,
          },
        ].map((item) => (
          <label key={item.label} className="text-xs text-slate-600">
            {item.label}
            <select
              className="mt-1 w-full rounded-lg border p-2 text-sm"
              value={item.value}
              onChange={(event) => item.set(event.target.value)}
            >
              {group.leads.map((lead) => (
                <option key={lead.id} value={lead.id}>
                  {lead.name} · {lead.status} · {lead.assignedTo}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!pending) setOpen(value);
        }}
      >
        <Button
          className="mt-3"
          size="sm"
          variant="outline"
          disabled={targetId === sourceId}
          onClick={() => {
            setConfirmation("");
            setError("");
            setOpen(true);
          }}
        >
          Review merge
        </Button>
        {open && (
          <DialogContent showCloseButton={!pending}>
            <DialogHeader>
              <DialogTitle>Review duplicate merge</DialogTitle>
            </DialogHeader>
            <p className="text-sm">
              <strong>{target.name}</strong> will remain active.{" "}
              <strong>{source.name}</strong> will be merged into it. The
              retained lead’s status and assignment stay unchanged; patient
              notes and history are preserved.
            </p>
            <p className="text-xs text-slate-500">
              A recovery snapshot is stored in the CRM and downloaded after
              saving. The duplicate active row is removed.
            </p>
            <label className="text-sm">
              Type {group.phone} to confirm
              <input
                className="mt-1 w-full rounded-lg border p-2"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                disabled={pending}
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-rose-700">
                {error}
              </p>
            )}
            <Button
              disabled={pending || confirmation !== group.phone}
              onClick={() => void merge()}
            >
              {pending ? "Merging..." : "Merge reviewed records"}
            </Button>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
