"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

import { assignDeletionReviewLeads, resolveDeletionReview, type LeadDeletionReviewView } from "@/app/actions/deletion-reviews";
import { toast } from "@/components/ui/toast";
import { PhonePreview } from "./phone-preview";
import { DeletionReviewDeleteButton } from "./deletion-review-delete-button";

function displayDate(value: string): string {
  return new Date(value).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function DeletionReviewList({
  reviews,
  employees,
  assignmentError,
}: {
  reviews: LeadDeletionReviewView[];
  employees: string[];
  assignmentError: string | null;
}) {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [asFresh, setAsFresh] = useState(false);
  const [pending, setPending] = useState(false);
  const statuses = useMemo(() => [...new Set(reviews.map((review) => review.status).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [reviews]);
  const assignees = useMemo(() => [...new Set(reviews.map((review) => review.assignedTo).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [reviews]);
  const normalizedSearch = searchTerm.trim().toLocaleLowerCase();
  const visibleReviews = useMemo(() => reviews.filter((review) =>
    (!normalizedSearch || review.leadName.toLocaleLowerCase().includes(normalizedSearch)) &&
    (statusFilter === "all" || review.status === statusFilter) &&
    (assigneeFilter === "all" || review.assignedTo === assigneeFilter),
  ), [reviews, normalizedSearch, statusFilter, assigneeFilter]);
  const visibleIds = visibleReviews.map((review) => review.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));

  function toggleReview(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function toggleEmployee(name: string) {
    setSelectedEmployees((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name]);
  }

  async function assignSelected() {
    if (pending || selectedIds.length === 0 || selectedEmployees.length === 0) return;
    setPending(true);
    try {
      const result = await assignDeletionReviewLeads({ reviewIds: selectedIds, employeeNames: selectedEmployees, asFresh });
      if (!result.success) {
        toast.add({ title: "Transfer failed", description: result.error ?? "The selected leads could not be reassigned.", type: "error" });
        return;
      }
      toast.add({
        title: asFresh ? "Leads sent as fresh" : "Lead status kept",
        description: `${result.assigned ?? 0} lead${result.assigned === 1 ? "" : "s"} reassigned. Previous notes and call history remain available.`,
        type: "success",
      });
      setSelectedIds([]);
      router.refresh();
    } catch (error) {
      toast.add({ title: "Transfer failed", description: error instanceof Error ? error.message : "The selected leads could not be reassigned.", type: "error" });
    } finally {
      setPending(false);
    }
  }

  if (!reviews.length) return <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">There are no closed leads waiting for review.</p>;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="block text-xs font-semibold text-slate-600">Search leads
          <span className="relative mt-1 block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input type="search" value={searchTerm} onChange={(event) => { setSearchTerm(event.target.value); setSelectedIds([]); }} placeholder="Search by patient name" aria-label="Search closed leads by patient name" className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm font-normal text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
          </span>
        </label>

        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap gap-3">
            <label className="text-xs font-semibold text-slate-600">Filter by closed status
              <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setSelectedIds([]); }} className="mt-1 block min-w-48 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-800">
                <option value="all">All statuses ({reviews.length})</option>
                {statuses.map((status) => <option key={status} value={status}>{status} ({reviews.filter((review) => review.status === status).length})</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-600">Filter by assigned agent
              <select value={assigneeFilter} onChange={(event) => { setAssigneeFilter(event.target.value); setSelectedIds([]); }} className="mt-1 block min-w-48 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-800">
                <option value="all">All agents ({reviews.length})</option>
                {assignees.map((name) => <option key={name} value={name}>{name} ({reviews.filter((review) => review.assignedTo === name).length})</option>)}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="self-center text-xs font-medium text-slate-500">{selectedIds.length} selected</span>
            <button type="button" disabled={!visibleIds.length || allVisibleSelected} onClick={() => setSelectedIds((current) => [...new Set([...current, ...visibleIds])])} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
              Select all matching ({visibleReviews.length})
            </button>
            <button type="button" disabled={!selectedIds.length} onClick={() => setSelectedIds([])} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50">Unselect all</button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 border-t border-slate-100 pt-4 lg:grid-cols-[minmax(0,1fr)_minmax(250px,0.8fr)]">
          <fieldset className="min-w-0">
            <legend className="text-xs font-semibold text-slate-700">Assign selected ({selectedIds.length})</legend>
            {assignmentError ? <p className="mt-2 text-sm text-rose-700">{assignmentError}</p> : employees.length === 0 ? <p className="mt-2 text-sm text-slate-500">No active employees are available for assignment.</p> : (
              <div className="mt-2 flex max-h-28 flex-wrap gap-2 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/70 p-2">
                {employees.map((employee) => <label key={employee} className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-white px-2.5 py-1.5 text-sm text-slate-700 ring-1 ring-slate-200 hover:bg-emerald-50">
                  <input type="checkbox" checked={selectedEmployees.includes(employee)} onChange={() => toggleEmployee(employee)} disabled={pending} className="accent-emerald-700" />{employee}
                </label>)}
              </div>
            )}
          </fieldset>
          <div className="space-y-2">
            <fieldset className="space-y-1.5">
              <legend className="text-xs font-semibold text-slate-700">How should the new agent receive them?</legend>
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-2 text-sm text-slate-700 hover:border-emerald-300">
                <input type="radio" name="closed-transfer-mode" checked={!asFresh} onChange={() => setAsFresh(false)} disabled={pending} className="mt-0.5 accent-emerald-700" />
                <span><span className="font-medium">Keep current status</span><span className="block text-xs text-slate-500">Closed status and review timing stay as they are.</span></span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50/50 p-2 text-sm text-slate-700 hover:border-emerald-400">
                <input type="radio" name="closed-transfer-mode" checked={asFresh} onChange={() => setAsFresh(true)} disabled={pending} className="mt-0.5 accent-emerald-700" />
                <span><span className="font-medium">Send as a Fresh Lead</span><span className="block text-xs text-slate-500">Status resets to New and the closed review ends; history is kept.</span></span>
              </label>
            </fieldset>
            <button type="button" onClick={() => void assignSelected()} disabled={pending || !selectedIds.length || !selectedEmployees.length || Boolean(assignmentError)} className="w-full rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">
              {pending ? "Assigning…" : `Assign ${selectedIds.length || "selected"} lead${selectedIds.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {visibleReviews.length === 0 && <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">No closed leads match these filters.</p>}
        {visibleReviews.map((review) => (
          <article key={review.id} className="crm-card-interactive rounded-xl border border-amber-200 bg-white p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <input aria-label={`Select ${review.leadName}`} type="checkbox" checked={selectedIds.includes(review.id)} onChange={() => toggleReview(review.id)} disabled={pending} className="mt-1 size-4 shrink-0 accent-emerald-700" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-slate-950">{review.leadName}</h3>
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">{review.status}</span>
                      {review.hadPreviousAssignment && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700">Previous history</span>}
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600"><PhonePreview value={review.phone} /><span>· Assigned to <strong className="font-medium text-slate-800">{review.assignedTo}</strong></span></p>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-slate-600">
                    <span className="size-2 rounded-full bg-amber-400" aria-hidden="true" />
                    {review.snoozedUntil ? `Snoozed until ${displayDate(review.snoozedUntil)}` : `Scheduled for ${displayDate(review.deleteAfter)}`}
                  </div>
                </div>

                {review.agentNote && <div className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-950"><p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Agent note</p><p className="mt-1 whitespace-pre-wrap">{review.agentNote}</p></div>}

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                  <DeletionReviewDeleteButton reviewId={review.id} />
                  <form action={resolveDeletionReview}>
                    <input type="hidden" name="reviewId" value={review.id} />
                    <input type="hidden" name="action" value="keep" />
                    <button type="submit" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50">Keep lead</button>
                  </form>
                  {[1, 2].map((days) => <form action={resolveDeletionReview} key={days}>
                    <input type="hidden" name="reviewId" value={review.id} />
                    <input type="hidden" name="action" value="snooze" />
                    <input type="hidden" name="snoozeDays" value={days} />
                    <button type="submit" className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-900 transition hover:bg-amber-100">Snooze {days} day{days === 1 ? "" : "s"}</button>
                  </form>)}
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
