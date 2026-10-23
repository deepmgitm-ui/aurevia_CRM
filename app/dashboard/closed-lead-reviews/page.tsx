import { redirect } from "next/navigation";

import { getViewer } from "@/app/actions/leads";
import { DeletionReviewPanel } from "../deletion-review-panel";

export default async function ClosedLeadReviewsPage() {
  const viewer = await getViewer();
  if (!viewer.success || viewer.data?.role !== "admin") redirect("/dashboard");

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">Closed Leads Review</h1>
        <p className="mt-2 text-sm text-slate-500">Review closed leads before the scheduled cleanup.</p>
      </div>
      <DeletionReviewPanel role="admin" />
    </div>
  );
}
