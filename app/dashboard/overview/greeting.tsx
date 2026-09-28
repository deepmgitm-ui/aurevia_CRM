"use client";

// ---------------------------------------------------------------------------
// Dynamic greeting banner — the first thing the team sees when the dashboard
// loads. Morning / afternoon / evening is derived from the visitor's LOCAL
// clock, so the greeting is rendered after mount (never during SSR) to avoid a
// server-vs-browser hydration mismatch. The wording itself lives in
// ./greeting-copy.ts so it stays unit-testable without React.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { CalendarDays, Sparkles } from "lucide-react";

import {
  GREETING_THEMES,
  cheerFor,
  formatGreetingDate,
  greetingHeadline,
  partOfDay,
  type PartOfDay,
} from "./greeting-copy";

export function DashboardGreeting({ name, role }: { name?: string; role?: string }) {
  const [part, setPart] = useState<PartOfDay | null>(null);
  const [today, setToday] = useState("");

  useEffect(() => {
    const apply = () => {
      const now = new Date();
      setPart(partOfDay(now.getHours()));
      setToday(formatGreetingDate(now));
    };
    apply();
    // A dashboard left open all day still flips morning → afternoon → evening.
    const timer = window.setInterval(apply, 30 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Pre-mount placeholder: keeps the layout height stable and the SSR markup
  // identical to the first client paint (no hydration mismatch).
  if (!part) {
    return (
      <div
        aria-hidden="true"
        className="h-[86px] animate-pulse rounded-2xl border border-slate-200 bg-slate-50/70 sm:h-[80px]"
      />
    );
  }

  const theme = GREETING_THEMES[part];

  return (
    <section
      aria-label="Greeting"
      className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 shadow-sm ${theme.tone}`}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className={`flex size-11 shrink-0 items-center justify-center rounded-2xl text-2xl ${theme.chip}`}
        >
          {theme.emoji}
        </span>
        <div>
          <p className="text-base font-semibold tracking-tight text-slate-900 sm:text-lg">
            {greetingHeadline(part, name)}{" "}
            <Sparkles className="inline size-4 text-amber-500" aria-hidden="true" />
          </p>
          <p className="text-sm text-slate-600">{cheerFor(role, part)}</p>
        </div>
      </div>

      <span className="flex items-center gap-2 rounded-xl border border-white/70 bg-white/70 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
        <CalendarDays className="size-3.5 text-slate-400" aria-hidden="true" />
        {today}
      </span>
    </section>
  );
}
