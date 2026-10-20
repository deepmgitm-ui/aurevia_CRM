"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Check, Loader2, X } from "lucide-react";

import {
  createEmployeeLeaveRequest,
  getEmployeeLeaveRequests,
  reviewEmployeeLeaveRequest,
  type EmployeeLeaveRequest,
} from "@/app/actions/attendance";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";

const LEAVE_TYPES: EmployeeLeaveRequest["leaveType"][] = ["Casual", "Sick", "Paid", "Unpaid", "Other"];

function leaveStatusClass(status: EmployeeLeaveRequest["status"]) {
  if (status === "Approved") return "bg-emerald-100 text-emerald-800";
  if (status === "Rejected") return "bg-rose-100 text-rose-800";
  return "bg-amber-100 text-amber-800";
}

function dateLabel(request: EmployeeLeaveRequest) {
  return request.startDate === request.endDate
    ? request.startDate
    : `${request.startDate} – ${request.endDate}`;
}

export function AttendanceLeave({
  todayIso,
  canAdmin,
}: {
  todayIso: string;
  canAdmin: boolean;
}) {
  const router = useRouter();
  const [requests, setRequests] = useState<EmployeeLeaveRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [leaveType, setLeaveType] = useState<EmployeeLeaveRequest["leaveType"]>("Casual");
  const [duration, setDuration] = useState<EmployeeLeaveRequest["duration"]>("full_day");
  const [reason, setReason] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getEmployeeLeaveRequests()
      .then((response) => {
        if (!active) return;
        if (response.success) {
          setRequests(response.data);
          setLoadError("");
        } else {
          setLoadError(response.error);
        }
        setIsLoading(false);
      })
      .catch(() => {
        if (active) {
          setLoadError("Leave requests could not be loaded. Please try again.");
          setIsLoading(false);
        }
      });
    return () => { active = false; };
  }, []);

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!startDate || !endDate || busyKey) return;
    setBusyKey("new");
    try {
      const response = await createEmployeeLeaveRequest({ startDate, endDate, leaveType, duration, reason });
      if (!response.success) {
        toast.add({ title: "Leave request not sent", description: response.error, type: "error" });
      } else {
        setRequests((current) => [response.data, ...current]);
        setStartDate("");
        setEndDate("");
        setReason("");
        toast.add({ title: "Leave request sent", description: "An admin will review your request.", type: "success" });
      }
    } catch (error) {
      toast.add({
        title: "Leave request not sent",
        description: error instanceof Error ? error.message : "Unable to reach the server. Please try again.",
        type: "error",
      });
    } finally {
      setBusyKey(null);
    }
  }

  async function reviewRequest(request: EmployeeLeaveRequest, approved: boolean) {
    if (busyKey) return;
    setBusyKey(request.id);
    try {
      const response = await reviewEmployeeLeaveRequest({
        id: request.id,
        approved,
        reviewNote: reviewNotes[request.id] ?? "",
      });
      if (!response.success) {
        toast.add({ title: "Leave review failed", description: response.error, type: "error" });
        return;
      }
      setRequests((current) => current.map((item) => item.id === request.id
        ? { ...item, status: response.data.status, reviewedAt: new Date().toISOString(), reviewNote: reviewNotes[request.id] ?? "" }
        : item));
      setReviewNotes((current) => {
        const next = { ...current };
        delete next[request.id];
        return next;
      });
      toast.add({ title: approved ? "Leave approved" : "Leave rejected", type: "success" });
      if (approved) router.refresh();
    } catch (error) {
      toast.add({
        title: "Leave review failed",
        description: error instanceof Error ? error.message : "Unable to reach the server. Please try again.",
        type: "error",
      });
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarDays className="size-4" aria-hidden="true" />
          Leave requests
        </CardTitle>
        <p className="text-xs text-slate-500">
          {canAdmin ? "Review employee leave requests. Approved dates are excluded from absence totals." : "Request full-day or half-day leave and track its review status."}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!canAdmin && (
          <form className="grid gap-3 rounded-lg border bg-slate-50/70 p-3 sm:grid-cols-2 lg:grid-cols-6" onSubmit={submitRequest}>
            <div className="space-y-1.5">
              <Label htmlFor="leave-start-date">Start date</Label>
              <Input id="leave-start-date" type="date" value={startDate} min={todayIso} required disabled={busyKey !== null} onChange={(event) => {
                const next = event.target.value;
                setStartDate(next);
                if (duration === "half_day") setEndDate(next);
                else if (endDate && endDate < next) setEndDate(next);
              }} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="leave-end-date">End date</Label>
              <Input id="leave-end-date" type="date" value={endDate} min={duration === "half_day" ? (startDate || todayIso) : (startDate || todayIso)} required disabled={busyKey !== null || duration === "half_day"} onChange={(event) => setEndDate(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="leave-type">Leave type</Label>
              <select id="leave-type" value={leaveType} disabled={busyKey !== null} onChange={(event) => setLeaveType(event.target.value as EmployeeLeaveRequest["leaveType"])} className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm">
                {LEAVE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="leave-duration">Duration</Label>
              <select id="leave-duration" value={duration} disabled={busyKey !== null} onChange={(event) => {
                const next = event.target.value as EmployeeLeaveRequest["duration"];
                setDuration(next);
                if (next === "half_day" && startDate) setEndDate(startDate);
              }} className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm">
                <option value="full_day">Full day</option>
                <option value="half_day">Half day</option>
              </select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="leave-reason">Reason (optional)</Label>
              <Input id="leave-reason" value={reason} maxLength={1000} disabled={busyKey !== null} placeholder="Add a brief reason" onChange={(event) => setReason(event.target.value)} />
            </div>
            <Button type="submit" className="self-end sm:col-span-2 lg:col-span-6 lg:justify-self-end" disabled={!startDate || !endDate || busyKey !== null}>
              {busyKey === "new" ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              Submit leave request
            </Button>
          </form>
        )}

        {loadError && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700" role="alert">{loadError}</p>}
        {isLoading ? (
          <p className="flex items-center gap-2 py-2 text-xs text-slate-500" role="status"><Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading leave requests...</p>
        ) : requests.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-3 text-xs text-slate-500">{canAdmin ? "There are no leave requests." : "Your leave requests will appear here."}</p>
        ) : (
          <ul className="max-h-[32rem] space-y-3 overflow-y-auto">
            {requests.map((request) => (
              <li key={request.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{canAdmin ? `${request.employeeName} · ` : ""}{dateLabel(request)}</p>
                    <p className="mt-1 text-xs text-slate-600">{request.leaveType} · {request.duration === "half_day" ? "Half day" : "Full day"}{request.reason ? ` · ${request.reason}` : ""}</p>
                    {request.reviewNote && <p className="mt-1 text-xs text-slate-500">Admin note: {request.reviewNote}</p>}
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${leaveStatusClass(request.status)}`}>{request.status}</span>
                </div>
                {canAdmin && request.status === "Pending" && (
                  <div className="mt-3 space-y-2">
                    <Textarea value={reviewNotes[request.id] ?? ""} maxLength={1000} rows={2} aria-label={`Review note for ${request.employeeName}'s leave request`} placeholder="Optional note for the employee" disabled={busyKey !== null} onChange={(event) => setReviewNotes((current) => ({ ...current, [request.id]: event.target.value }))} />
                    <div className="flex justify-end gap-2">
                      <Button type="button" size="sm" variant="outline" disabled={busyKey !== null} onClick={() => void reviewRequest(request, false)}>{busyKey === request.id ? <Loader2 className="animate-spin" aria-hidden="true" /> : <X aria-hidden="true" />} Reject</Button>
                      <Button type="button" size="sm" disabled={busyKey !== null} onClick={() => void reviewRequest(request, true)}>{busyKey === request.id ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />} Approve</Button>
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
