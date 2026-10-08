"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, Clock3, Loader2, X } from "lucide-react";

import {
  createAttendanceRequest,
  getAttendanceRequests,
  reviewAttendanceRequest,
  type AttendanceRequest,
} from "@/app/actions/attendance";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";

function requestStatusClass(status: AttendanceRequest["status"]) {
  if (status === "Approved") return "bg-emerald-100 text-emerald-800";
  if (status === "Rejected") return "bg-rose-100 text-rose-800";
  return "bg-amber-100 text-amber-800";
}

function yesterdayIso(todayIso: string) {
  const [year, month, day] = todayIso.split("-").map(Number);
  const yesterday = new Date(year, month - 1, day - 1);
  return `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
}

export function AttendanceRequests({
  canManage,
  todayIso,
}: {
  canManage: boolean;
  todayIso: string;
}) {
  const router = useRouter();
  const [requests, setRequests] = useState<AttendanceRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    setIsLoading(true);
    const response = await getAttendanceRequests();
    if (!response.success) {
      setLoadError(response.error);
    } else {
      setLoadError("");
      setRequests(response.data);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!date || busyKey) return;
    setBusyKey("new");
    try {
      const response = await createAttendanceRequest({ date, reason });
      if (!response.success) {
        toast.add({ title: "Request not sent", description: response.error, type: "error" });
      } else {
        setRequests((current) => [response.data, ...current]);
        setDate("");
        setReason("");
        toast.add({
          title: "Attendance request sent",
          description: "An admin or manager can review it.",
          type: "success",
        });
      }
    } catch (error) {
      toast.add({
        title: "Request not sent",
        description: error instanceof Error ? error.message : "Unable to reach the server. Please try again.",
        type: "error",
      });
    } finally {
      setBusyKey(null);
    }
  }

  async function reviewRequest(request: AttendanceRequest, approved: boolean) {
    if (busyKey) return;
    setBusyKey(request.id);
    try {
      const response = await reviewAttendanceRequest({
        id: request.id,
        approved,
        reviewNote: reviewNotes[request.id] ?? "",
      });
      if (!response.success) {
        toast.add({ title: "Request review failed", description: response.error, type: "error" });
        await loadRequests();
      } else {
        setRequests((current) =>
          current.map((item) =>
            item.id === request.id
              ? {
                  ...item,
                  status: response.data.status,
                  reviewedAt: new Date().toISOString(),
                  reviewNote: reviewNotes[request.id] ?? "",
                }
              : item,
          ),
        );
        setReviewNotes((current) => {
          const next = { ...current };
          delete next[request.id];
          return next;
        });
        toast.add({
          title: approved ? "Request approved" : "Request rejected",
          description: approved ? `${request.employeeName}'s attendance was marked Present.` : undefined,
          type: "success",
        });
        if (approved) router.refresh();
      }
    } catch (error) {
      toast.add({
        title: "Request review failed",
        description: error instanceof Error ? error.message : "Unable to reach the server. Please try again.",
        type: "error",
      });
      await loadRequests();
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock3 className="size-4" aria-hidden="true" />
          {canManage ? "Missed sign-in requests" : "Request missed attendance"}
        </CardTitle>
        <p className="text-xs text-slate-500">
          {canManage
            ? "Approve to record the employee as Present, or reject the request."
            : "If you were at work but forgot to sign in, request a correction for that past date."}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!canManage && (
          <form className="grid gap-3 rounded-lg border bg-slate-50/70 p-3 sm:grid-cols-[180px_1fr_auto]" onSubmit={submitRequest}>
            <div className="space-y-1.5">
              <Label htmlFor="attendance-request-date">Date you attended</Label>
              <Input
                id="attendance-request-date"
                type="date"
                value={date}
                max={yesterdayIso(todayIso)}
                required
                disabled={busyKey !== null}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="attendance-request-reason">Reason (optional)</Label>
              <Textarea
                id="attendance-request-reason"
                value={reason}
                maxLength={1000}
                rows={2}
                placeholder="Why couldn't you sign in?"
                disabled={busyKey !== null}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
            <Button type="submit" className="self-end" disabled={!date || busyKey !== null}>
              {busyKey === "new" ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              Send request
            </Button>
          </form>
        )}

        {loadError && (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700" role="alert">
            {loadError}
          </p>
        )}
        {isLoading ? (
          <p className="flex items-center gap-2 py-2 text-xs text-slate-500" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading requests...
          </p>
        ) : requests.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-3 text-xs text-slate-500">
            {canManage ? "There are no attendance requests." : "Your attendance requests will appear here."}
          </p>
        ) : (
          <ul className="max-h-96 space-y-3 overflow-y-auto">
            {requests.map((request) => (
              <li key={request.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {canManage ? `${request.employeeName} · ` : ""}{request.date}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      {request.reason || "No reason provided."}
                    </p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${requestStatusClass(request.status)}`}>
                    {request.status}
                  </span>
                </div>
                {request.reviewNote && (
                  <p className="mt-2 text-xs text-slate-500">Admin note: {request.reviewNote}</p>
                )}
                {canManage && request.status === "Pending" && (
                  <div className="mt-3 space-y-2">
                    <Textarea
                      value={reviewNotes[request.id] ?? ""}
                      maxLength={1000}
                      rows={2}
                      aria-label={`Review note for ${request.employeeName}'s request`}
                      placeholder="Optional note for the employee"
                      disabled={busyKey !== null}
                      onChange={(event) =>
                        setReviewNotes((current) => ({ ...current, [request.id]: event.target.value }))
                      }
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busyKey !== null}
                        onClick={() => void reviewRequest(request, false)}
                      >
                        {busyKey === request.id ? <Loader2 className="animate-spin" aria-hidden="true" /> : <X aria-hidden="true" />}
                        Reject
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={busyKey !== null}
                        onClick={() => void reviewRequest(request, true)}
                      >
                        {busyKey === request.id ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
                        Approve & mark Present
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
