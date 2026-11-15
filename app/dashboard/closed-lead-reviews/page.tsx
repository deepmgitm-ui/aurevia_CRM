import { redirect } from "next/navigation";

import { getViewer } from "@/app/actions/leads";
import { DeletionReviewPanel } from "../deletion-review-panel";

export default async function ClosedLeadReviewsPage() {
  const viewer = await getViewer();
  if (!viewer.success || !viewer.data || !["admin", "manager"].includes(viewer.data.role)) redirect("/dashboard");

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">Review &amp; Delete Lost Leads</h1>
        <p className="mt-2 text-sm text-slate-500">Not Interested and Lost leads enter after seven days. Budget and location issues stay in their own status counts.</p>
      </div>
      <DeletionReviewPanel role={viewer.data.role} />
    </div>
  );
}
