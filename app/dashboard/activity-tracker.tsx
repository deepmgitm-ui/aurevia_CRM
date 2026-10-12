"use client";

import { useEffect } from "react";
import { recordMyActivity } from "@/app/actions/team-activity";

export function ActivityTracker() {
  useEffect(() => {
    let lastInteraction = performance.now();
    let lastAttempt = -Infinity;
    let pending = false;
    let cancelled = false;
    const interacted = () => {
      lastInteraction = performance.now();
    };
    const events = [
      "pointerdown",
      "pointermove",
      "keydown",
      "scroll",
      "touchstart",
    ] as const;
    for (const event of events)
      window.addEventListener(event, interacted, { passive: true });
    async function heartbeat() {
      if (
        cancelled ||
        pending ||
        document.visibilityState !== "visible" ||
        !navigator.onLine ||
        performance.now() - lastAttempt < 55_000
      )
        return;
      pending = true;
      lastAttempt = performance.now();
      try {
        // Send only a boolean, never keys, clicks, patient names or page content.
        const success = await recordMyActivity(
          performance.now() - lastInteraction < 65_000,
        );
        if (!cancelled)
          window.dispatchEvent(
            new CustomEvent("crm:activity-health", { detail: success }),
          );
      } catch {
        if (!cancelled)
          window.dispatchEvent(
            new CustomEvent("crm:activity-health", { detail: false }),
          );
      } finally {
        pending = false;
      }
    }
    const timer = setInterval(() => void heartbeat(), 60_000);
    const resumed = () => {
      if (document.visibilityState === "visible") {
        lastInteraction = performance.now();
        void heartbeat();
      }
    };
    document.addEventListener("visibilitychange", resumed);
    window.addEventListener("online", resumed);
    void heartbeat();
    return () => {
      cancelled = true;
      clearInterval(timer);
      for (const event of events) window.removeEventListener(event, interacted);
      document.removeEventListener("visibilitychange", resumed);
      window.removeEventListener("online", resumed);
    };
  }, []);
  return null;
}
