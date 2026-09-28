// ---------------------------------------------------------------------------
// Celebration — the instant dopamine hit fired when a lead reaches the surgery
// stage ("Won" / "IPD Done" / "Surgery Completed").
//
// The confetti library (~6 kB) is imported lazily *inside* the click handler, so
// it never lands in the dashboard's first-paint bundle and users who never mark
// a win never download it. Everything here is decoration: a failure can never
// break the status update itself.
// ---------------------------------------------------------------------------

import { toast } from "@/components/ui/toast";

const CONFETTI_COLORS = ["#1d4ed8", "#60a5fa", "#a855f7", "#f472b6", "#10b981", "#f59e0b"];

type ConfettiFn = (options?: Record<string, unknown>) => unknown;

const WIN_BLURBS = [
  "That's another patient on the board. 🏆",
  "The pipeline is on fire! 🔥",
  "Champagne moment — keep them coming! 🥂",
  "Closer of the day? Looking like it. 🥇",
];

/** Lazily loads canvas-confetti (CJS `export =` shape, hence the interop cast). */
async function loadConfetti(): Promise<ConfettiFn | null> {
  try {
    const imported = (await import("canvas-confetti")) as unknown as ConfettiFn | { default?: ConfettiFn };
    if (typeof imported === "function") return imported;
    return imported.default ?? null;
  } catch {
    return null;
  }
}

async function fireConfetti(): Promise<void> {
  if (typeof window === "undefined") return;
  // Respect "reduce motion" before we even pay for the import.
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  const fire = await loadConfetti();
  if (!fire) return;

  const base = { colors: CONFETTI_COLORS, disableForReducedMotion: true, zIndex: 70 };
  fire({ ...base, particleCount: 90, spread: 70, startVelocity: 45, origin: { x: 0.5, y: 0.7 } });
  window.setTimeout(() => {
    fire({ ...base, particleCount: 60, spread: 100, startVelocity: 35, origin: { x: 0.2, y: 0.6 } });
    fire({ ...base, particleCount: 60, spread: 100, startVelocity: 35, origin: { x: 0.8, y: 0.6 } });
  }, 180);
}

/**
 * Reward toast + confetti for a lead that just converted. `status` is shown
 * verbatim so both "Won" and "IPD Done" read naturally.
 */
export function celebrateLeadWin({ name, status }: { name: string; status: string }): void {
  const who = name?.trim() || "This lead";
  const blurb = WIN_BLURBS[Math.floor(Math.random() * WIN_BLURBS.length)];
  toast.add({
    title: `${status} — congratulations! 🎉`,
    description: `${who} just converted. ${blurb}`,
    type: "success",
  });
  void fireConfetti();
}
