// ---------------------------------------------------------------------------
// Greeting copy + time helpers.
//
// Deliberately JSX-free (and dependency-free) so the dashboard wording can be
// unit-tested by `npm run verify:analytics` without pulling React into Node.
// ---------------------------------------------------------------------------

export type PartOfDay = "morning" | "afternoon" | "evening";

export interface GreetingTheme {
  label: string;
  emoji: string;
  /** Gradient + border classes for the banner shell. */
  tone: string;
  /** Accent classes for the emoji chip. */
  chip: string;
}

export const GREETING_THEMES: Record<PartOfDay, GreetingTheme> = {
  morning: {
    label: "Good Morning",
    emoji: "☀️",
    tone: "border-amber-100 bg-gradient-to-r from-amber-50 via-orange-50 to-white",
    chip: "bg-amber-100 text-amber-700",
  },
  afternoon: {
    label: "Good Afternoon",
    emoji: "🌤️",
    tone: "border-sky-100 bg-gradient-to-r from-sky-50 via-blue-50 to-white",
    chip: "bg-sky-100 text-sky-700",
  },
  evening: {
    label: "Good Evening",
    emoji: "🌙",
    tone: "border-indigo-100 bg-gradient-to-r from-indigo-50 via-violet-50 to-white",
    chip: "bg-indigo-100 text-indigo-700",
  },
};

/** 00:00–11:59 morning, 12:00–16:59 afternoon, 17:00+ evening. */
export function partOfDay(hour: number): PartOfDay {
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

/** Role-aware cheer so the line feels written for the person reading it. */
export function cheerFor(role: string | undefined, part: PartOfDay): string {
  if (role === "employee") {
    return part === "evening"
      ? "Nice work today — log your follow-ups before you clock off! 📞"
      : "Your pipeline is waiting — check today's follow-ups! 📞";
  }
  if (role === "manager") {
    return "Your team is counting on you — let's move the pipeline! 📈";
  }
  return part === "evening" ? "Great day of work — let's finish strong! ✨" : "Let's close some deals today! 🚀";
}

/** e.g. "Friday, 26 Sep" for the banner's date chip. */
export function formatGreetingDate(date: Date): string {
  return date.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "short" });
}

/** Full first line, e.g. "Good Morning, Admin!". */
export function greetingHeadline(part: PartOfDay, name: string | undefined): string {
  const displayName = (name ?? "").trim() || "there";
  return `${GREETING_THEMES[part].label}, ${displayName}!`;
}
