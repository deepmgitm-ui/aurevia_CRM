"use client";

import { useState } from "react";
import { maskPhoneForList } from "@/lib/phone-display";

/** Compact patient phone display with an explicit per-item reveal control. */
export function PhonePreview({
  value,
  className = "",
}: {
  value: string | null | undefined;
  className?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  if (!value || value === "-") return <span className={className}>-</span>;

  return (
    <button
      type="button"
      className={`inline-flex max-w-full items-center gap-1 text-left ${className}`}
      aria-label={revealed ? "Hide phone number" : "Reveal phone number"}
      aria-pressed={revealed}
      title={revealed ? "Hide phone number" : "Tap to reveal phone number"}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setRevealed((current) => !current);
      }}
    >
      <span className="truncate tabular-nums">{revealed ? value : maskPhoneForList(value)}</span>
      <span className="shrink-0 text-[10px] text-slate-400">{revealed ? "Hide" : "Show"}</span>
    </button>
  );
}
