"use client";

import { useEffect, useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { maskPhoneForList } from "@/lib/phone-display";

const REVEAL_EVENT = "aurevia:phone-preview-reveal";

/** Compact patient phone display with an explicit per-item reveal control. */
export function PhonePreview({
  value,
  className = "",
}: {
  value: string | null | undefined;
  className?: string;
}) {
  const id = useId();
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const hideWhenAnotherPhoneOpens = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) setRevealed(false);
    };
    window.addEventListener(REVEAL_EVENT, hideWhenAnotherPhoneOpens);
    return () => window.removeEventListener(REVEAL_EVENT, hideWhenAnotherPhoneOpens);
  }, [id]);

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
        if (revealed) {
          setRevealed(false);
        } else {
          window.dispatchEvent(new CustomEvent(REVEAL_EVENT, { detail: id }));
          setRevealed(true);
        }
      }}
    >
      <span className="truncate tabular-nums">{revealed ? value : maskPhoneForList(value)}</span>
      {revealed ? <EyeOff aria-hidden="true" className="size-3.5 shrink-0 text-slate-400" /> : <Eye aria-hidden="true" className="size-3.5 shrink-0 text-slate-400" />}
    </button>
  );
}
