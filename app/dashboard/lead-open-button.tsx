"use client";

// Zoho-style "tap the record name" affordance: a plain link-shaped button that
// opens the shared lead detail drawer WITHOUT dragging the parent into drawer
// state (patient tables, pipeline previews, calendar chips all use it).
import { useState, type ReactNode } from "react";

import { LeadDetailDrawer, type LeadDetailTab } from "./lead-detail-drawer";

/** Zoho-style: a plain link-shaped button that opens ONE lead's detail drawer. */
export function LeadOpenButton({
  className,
  label,
  leadId,
  title,
  tab,
}: {
  className?: string;
  label: ReactNode;
  leadId: string;
  title?: string;
  tab?: LeadDetailTab;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {label}
      </button>
      <LeadDetailDrawer leadId={leadId} tab={tab} open={open} title={title} onOpenChange={setOpen} />
    </>
  );
}
