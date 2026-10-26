// ---------------------------------------------------------------------------
// Greeting copy + time helpers.
//
// Deliberately JSX-free (and dependency-free) so the dashboard wording can be
// unit-tested by `npm run verify:analytics` without pulling React into Node.
// ---------------------------------------------------------------------------

export type PartOfDay = "morning" | "afternoon" | "evening";
export type GreetingGender = "Male" | "Female" | "Prefer not to say" | "";

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
    tone: "border-emerald-100 bg-gradient-to-r from-emerald-50 via-white to-white",
    chip: "bg-emerald-100 text-emerald-700",
  },
  afternoon: {
    label: "Good Afternoon",
    emoji: "🌤️",
    tone: "border-emerald-100 bg-gradient-to-r from-teal-50 via-white to-white",
    chip: "bg-teal-100 text-teal-700",
  },
  evening: {
    label: "Good Evening",
    emoji: "🌙",
    tone: "border-emerald-100 bg-gradient-to-r from-green-50 via-white to-white",
    chip: "bg-green-100 text-green-700",
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

/** Keep legacy profile values safe while using only the explicit title choices. */
export function normalizeGreetingGender(value: string | null | undefined): GreetingGender {
  const normalized = (value ?? "").trim().toLowerCase();
  if (["male", "m", "man"].includes(normalized)) return "Male";
  if (["female", "f", "woman"].includes(normalized)) return "Female";
  if (normalized === "prefer not to say") return "Prefer not to say";
  return "";
}

/** Full first line, e.g. "Good Morning, Mr. Deep!". */
export function greetingHeadline(
  part: PartOfDay,
  name: string | undefined,
  gender?: string | null,
): string {
  const displayName = (name ?? "").trim() || "there";
  const preference = normalizeGreetingGender(gender);
  const salutation = preference === "Male" ? "Mr. " : preference === "Female" ? "Ms. " : "";
  return `${GREETING_THEMES[part].label}, ${salutation}${displayName}!`;
}
