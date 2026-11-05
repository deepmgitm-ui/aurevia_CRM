"use client";

import { useSyncExternalStore } from "react";

const RENDER_URL = "https://aurevia-crm.onrender.com";
const subscribe = () => () => {};

export function RenderFallbackNotice() {
  const show = useSyncExternalStore(subscribe, () => window.location.hostname.toLowerCase().endsWith(".vercel.app"), () => false);

  if (!show) return null;

  return (
    <aside
      aria-label="Alternate CRM address"
      className="fixed bottom-3 left-3 z-[90] flex max-w-[calc(100vw-1.5rem)] flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-emerald-200 bg-white/95 px-3 py-2 text-xs text-slate-600 shadow-lg backdrop-blur-sm sm:left-4 sm:px-4"
    >
      <span>If this Vercel page has an issue, use Render:</span>
      <a
        href={RENDER_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-emerald-800 underline decoration-emerald-300 underline-offset-2 hover:text-emerald-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
      >
        aurevia-crm.onrender.com ↗
      </a>
    </aside>
  );
}
