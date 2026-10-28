import { AlertTriangle } from "lucide-react";

import { getDeletionReviewAssignees, getDeletionReviews } from "@/app/actions/deletion-reviews";
import { DeletionReviewList } from "./deletion-review-list";

export async function DeletionReviewPanel({ role }: { role: string }) {
  if (role !== "admin") return null;
  const [result, team] = await Promise.all([getDeletionReviews(), getDeletionReviewAssignees()]);
  if (!result.reviews.length && !result.error) return null;

  return (
    <section aria-label="Lead deletion reviews" className="space-y-4 rounded-2xl border border-amber-200 bg-amber-50/70 p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-800">
          <AlertTriangle className="size-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-slate-950">
            Closed lead reviews
            {result.reviews.length > 0 && <span className="ml-2 rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-950">{result.reviews.length}</span>}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Filter by status, reassign selected leads, or keep, snooze, and delete before scheduled cleanup.
          </p>
        </div>
      </div>

      {result.error ? <p role="alert" className="text-sm text-rose-700">{result.error}</p> : <DeletionReviewList reviews={result.reviews} employees={team.names} assignmentError={team.error} />}
    </section>
  );
}
