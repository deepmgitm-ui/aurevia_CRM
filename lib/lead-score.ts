export type LeadScoreInput = {
  status?: string | null;
  temperature?: string | null;
  follow_up_date?: string | null;
  phone?: string | null;
  insurance_status?: string | null;
};

function dateKey(value: string | null | undefined): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw || raw === "-") return "";
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const dmy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return "";
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Rule-based operational priority — not an AI prediction.
// It helps the team decide which follow-up deserves attention first.
export function getLeadPriorityScore(lead: LeadScoreInput): number {
  let score = 0;
  const temperature = String(lead.temperature ?? "").toLowerCase();
  const status = String(lead.status ?? "").toLowerCase();
  const followUp = dateKey(lead.follow_up_date);
  const today = todayKey();

  if (temperature === "hot") score += 35;
  else if (temperature === "warm") score += 20;
  else if (temperature === "cold") score += 5;

  if (status === "new") score += 15;
  else if (status === "follow up") score += 12;
  else if (status === "opd booked") score += 25;
  else if (status === "opd done") score += 15;
  else if (status === "budget issue" || status === "location issue") score += 6;
  else if (status === "won" || status === "lost") score = Math.max(0, score - 40);

  if (followUp === today) score += 25;
  else if (followUp && followUp < today) score += 30;
  else if (followUp) score += 8;

  if (lead.phone && lead.phone !== "-") score += 5;
  if (lead.insurance_status && lead.insurance_status !== "-") score += 5;

  return Math.max(0, Math.min(100, score));
}

export function getPriorityLabel(score: number): "Critical" | "High" | "Normal" {
  if (score >= 70) return "Critical";
  if (score >= 45) return "High";
  return "Normal";
}
