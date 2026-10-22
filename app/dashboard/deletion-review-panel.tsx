import { AlertTriangle, Clock3, ShieldCheck } from "lucide-react";

import { getDeletionReviews, resolveDeletionReview, submitDeletionReviewNote } from "@/app/actions/deletion-reviews";

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

export async function DeletionReviewPanel({ role }: { role: string }) {
  if (role !== "admin" && role !== "employee") return null;
  const result = await getDeletionReviews();
  if (!result.reviews.length && !result.error) return null;

  return (
    <section aria-label="Lead deletion reviews" className="space-y-4 rounded-2xl border border-amber-200 bg-amber-50/70 p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-800">
          {role === "admin" ? <AlertTriangle className="size-5" aria-hidden="true" /> : <ShieldCheck className="size-5" aria-hidden="true" />}
        </span>
        <div>
          <h2 className="text-base font-semibold text-slate-950">
            {role === "admin" ? "Closed lead reviews" : "Lead review requests"}
            {result.reviews.length > 0 && <span className="ml-2 rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-950">{result.reviews.length}</span>}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {role === "admin"
              ? "Review each closed lead. Delete permanently or keep it in the CRM."
              : "These closed leads are scheduled for review. Add a note for your administrator if they should be kept."}
          </p>
        </div>
      </div>

      {result.error ? <p role="alert" className="text-sm text-rose-700">{result.error}</p> : (
        <div className="space-y-3">
          {result.reviews.map((review) => (
            <article key={review.id} className="rounded-xl border border-amber-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-slate-950">{review.leadName}</h3>
                  <p className="mt-1 text-sm text-slate-600">{review.phone || "No phone recorded"} · {review.status}</p>
                  {role === "admin" && <p className="mt-1 text-xs text-slate-500">Assigned to {review.assignedTo}</p>}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-slate-600">
                  <Clock3 className="size-3.5" aria-hidden="true" />
                  {review.snoozedUntil
                    ? `Snoozed until ${displayDate(review.snoozedUntil)}`
                    : `Scheduled for ${displayDate(review.deleteAfter)}`}
                </div>
              </div>

              {review.agentNote && (
                <div className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-950">
                  <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Agent note</p>
                  <p className="mt-1 whitespace-pre-wrap">{review.agentNote}</p>
                </div>
              )}

              {role === "employee" ? (
                <form action={submitDeletionReviewNote} className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input type="hidden" name="reviewId" value={review.id} />
                  <label className="sr-only" htmlFor={`review-note-${review.id}`}>Note for administrator</label>
                  <textarea id={`review-note-${review.id}`} name="note" maxLength={1200} required rows={2} placeholder="Add context for your administrator" className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
                  <button type="submit" className="self-start rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700">Send note</button>
                </form>
              ) : (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <form action={resolveDeletionReview}>
                    <input type="hidden" name="reviewId" value={review.id} />
                    <input type="hidden" name="action" value="delete" />
                    <button type="submit" className="rounded-lg bg-rose-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-rose-800">Delete permanently</button>
                  </form>
                  <form action={resolveDeletionReview}>
                    <input type="hidden" name="reviewId" value={review.id} />
                    <input type="hidden" name="action" value="keep" />
                    <button type="submit" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50">Keep lead</button>
                  </form>
                  {[1, 2].map((days) => (
                    <form action={resolveDeletionReview} key={days}>
                      <input type="hidden" name="reviewId" value={review.id} />
                      <input type="hidden" name="action" value="snooze" />
                      <input type="hidden" name="snoozeDays" value={days} />
                      <button type="submit" className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-900 transition hover:bg-amber-100">Snooze {days} day{days === 1 ? "" : "s"}</button>
                    </form>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
