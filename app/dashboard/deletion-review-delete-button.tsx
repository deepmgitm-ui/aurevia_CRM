"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { getDeletionReviewLeadForExport, resolveDeletionReview } from "@/app/actions/deletion-reviews";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import type { LeadExcelRecord } from "@/lib/lead-excel";

export function DeletionReviewDeleteButton({ reviewId }: { reviewId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function deleteLead() {
    if (pending) return;
    setPending(true);
    try {
      const backup = await getDeletionReviewLeadForExport(reviewId);
      if (!backup.success || !backup.lead) {
        toast.add({ title: "Delete cancelled", description: backup.error ?? "The Excel backup could not be prepared.", type: "error" });
        return;
      }
      const excel = await import("@/lib/lead-excel");
      await excel.downloadLeadsExcel(
        [backup.lead as LeadExcelRecord],
        `deleted-lead-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.xlsx`,
      );
      const formData = new FormData();
      formData.set("reviewId", reviewId);
      formData.set("action", "delete");
      await resolveDeletionReview(formData);
      toast.add({ title: "Lead deleted", description: "An Excel backup was downloaded and the lead was removed.", type: "success" });
      router.refresh();
    } catch (error) {
      toast.add({ title: "Delete failed", description: error instanceof Error ? error.message : "The lead could not be deleted.", type: "error" });
    } finally {
      setPending(false);
    }
  }

  return (
    <Button type="button" variant="destructive" size="sm" disabled={pending} onClick={() => void deleteLead()}>
      {pending ? "Preparing backup…" : "Delete permanently"}
    </Button>
  );
}
