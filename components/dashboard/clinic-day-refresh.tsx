"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

function currentClinicDate(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/** Refreshes the employee's default dashboard when the clinic day rolls over. */
export function ClinicDayRefresh() {
  const router = useRouter();

  useEffect(() => {
    let timer: number | undefined;
    let active = true;

    const schedule = () => {
      const current = currentClinicDate();
      const [year, month, day] = current.split("-").map(Number);
      const nextDate = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
      const nextMidnight = new Date(`${nextDate}T00:00:00+05:30`).getTime();
      timer = window.setTimeout(() => {
        if (!active) return;
        router.refresh();
        schedule();
      }, Math.max(1000, nextMidnight - Date.now() + 250));
    };

    schedule();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [router]);

  return null;
}
