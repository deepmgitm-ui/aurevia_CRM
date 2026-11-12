import Link from "next/link";
import { AlertCircle, ArrowRight, Clock3 } from "lucide-react";

import { getLostLeadReminderItems } from "@/app/actions/deletion-reviews";
import { DeletionReviewDeleteButton } from "./deletion-review-delete-button";

const clinicDateTime = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

export async function LostLeadReminderWidget() {
  const { items, error } = await getLostLeadReminderItems();
  if (!error && items.length === 0) return null;

  return (
    <section aria-labelledby="lost-lead-reminder-title" className="rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-800">
            <AlertCircle className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h2 id="lost-lead-reminder-title" className="font-semibold text-amber-950">Review &amp; Delete Lost Leads</h2>
            <p className="mt-1 max-w-2xl text-sm text-amber-900/80">
              These leads have been closed for at least a week. This reminder stays here until a lead is deleted or its status changes.
            </p>
          </div>
        </div>
        <Link href="/dashboard/closed-lead-reviews" className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-amber-400 bg-white px-3 py-2 text-sm font-medium text-amber-950 transition-colors hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">
          View all <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>

      {error ? (
        <p role="alert" className="mt-4 rounded-lg bg-white/80 p-3 text-sm text-amber-950">{error}</p>
      ) : (
        <ul className="mt-4 divide-y divide-amber-200 rounded-xl border border-amber-200 bg-white">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-3 sm:p-4">
              <div className="min-w-0">
                <p className="break-words font-medium text-slate-950">{item.leadName}</p>
                <p className="mt-1 text-xs text-slate-600">
                  {item.phone || "No phone"} · {item.status} · Assigned to {item.assignedTo}
                </p>
                <p className="mt-1 inline-flex items-center gap-1 text-xs text-slate-500">
                  <Clock3 className="size-3.5" aria-hidden="true" /> Closed {clinicDateTime.format(new Date(item.closedSince))}
                </p>
              </div>
              <DeletionReviewDeleteButton reviewId={item.id} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
