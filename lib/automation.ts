// Aurevia CRM — workflow automation rule engine.
//
// PURE module: no Supabase, no React, no hidden clock (every entry point takes
// an explicit `now`), so `scripts/verify-automation.mts` can assert each rule
// without a database. app/actions/automation.ts is the thin I/O shell around
// it: read rules → scan leads → matchChanges → apply patch → write receipt.
//
// Rules only ever change status, temperature, assigned_to and follow-up/note
// data, and NEVER delete.

export type AutomationRuleKey = "welcome" | "nudge" | "overdue" | "balance" | "celebrate";

export interface AutomationChange {
  leadId: string;
  name: string;
  phone: string | null;
  assignedTo: string | null;
  patch: { status?: string; temperature?: string; assignedTo?: string; followUpDate?: string; note?: string };
  reason: string;
}

/** Lead projection the engine needs — never `select('*')`. */
export interface LeadLite {
  id: string;
  name: string;
  phone: string | null;
  status: string;
  temperature: string;
  assigned_to: string | null;
  follow_up_date: string;
  updated_at: string;
}

export interface AutomationRuleSeed {
  key: AutomationRuleKey;
  label: string;
  stage: string;
}

// Max rows ONE run may touch — a robot with a hard cap cannot run amok.
export const AUTOMATION_CAP = 200;
// A run scans at most this many candidate rows to find matches.
export const AUTOMATION_SCAN = 1000;

export const ALL_RULES: AutomationRuleSeed[] = [
  { key: "welcome", label: "Welcome new leads (New + Warm + follow-up tomorrow)", stage: "new" },
  { key: "nudge", label: "Nudge cooling leads (Warm, inactive 7+ days)", stage: "contacted" },
  { key: "overdue", label: "Escalate overdue follow-ups (Hot temperature)", stage: "contacted" },
  { key: "balance", label: "Balance workload (auto-assign unassigned)", stage: "new" },
  { key: "celebrate", label: "Celebrate surgery wins (Surgery Completed)", stage: "surgery" },
];

/** Local (not UTC) YYYY-MM-DD — follow-up dates are clinic-local days. */
export function todayKeyLocal(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isoToDayKey(value: string): string {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

export function addDaysKey(baseKey: string, days: number): string {
  const [year, month, day] = baseKey.split("-").map(Number);
  const date = new Date(year, (month ?? 1) - 1, day ?? 1);
  date.setDate(date.getDate() + days);
  return todayKeyLocal(date);
}

/** Accepts both stored formats (DD/MM/YYYY from Excel/Meta, ISO from Postgres). */
export function toFollowUpDate(value: string): string {
  const dmy = String(value ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  const iso = String(value ?? "").trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  return "";
}

export function isStaleFollowUp(followUp: string, todayKey: string): boolean {
  const key = toFollowUpDate(followUp);
  return Boolean(key) && key < todayKey;
}

export function daysSinceIso(iso: string, todayKey: string): number | null {
  const key = isoToDayKey(iso);
  if (!key) return null;
  const [ty, tm, td] = todayKey.split("-").map(Number);
  const [ly, lm, ld] = key.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(ly, lm - 1, ld)) / 86400000);
}


// Pure matcher: given candidates, return the concrete changes — shared by
// preview and run, so "preview shows X" can never mean "run does Y".
export function matchChanges(
  ruleKey: AutomationRuleKey,
  leads: LeadLite[],
  agents: string[],
  now = new Date(),
): { changes: AutomationChange[]; scanned: number } {
  const todayKey = todayKeyLocal(now);
  const changes: AutomationChange[] = [];

  if (ruleKey === "welcome") {
    // Fresh arrivals nobody warmed up yet: warmth + a next-day callback.
    for (const lead of leads) {
      if (changes.length >= AUTOMATION_CAP) break;
      if (String(lead.status ?? "").trim().toLowerCase() !== "new") continue;
      if (String(lead.temperature ?? "").trim().toLowerCase() === "hot") continue;
      if (String(lead.follow_up_date ?? "").trim() && !isStaleFollowUp(lead.follow_up_date, todayKey)) continue;
      changes.push({
        leadId: lead.id,
        name: lead.name,
        phone: lead.phone,
        assignedTo: lead.assigned_to,
        patch: { temperature: "Warm", followUpDate: addDaysKey(todayKey, 1) },
        reason: "New lead — warming up + tomorrow's follow-up booked",
      });
    }
    return { changes, scanned: leads.length };
  }

  if (ruleKey === "nudge") {
    // Warm leads untouched for 7+ days: keep warm, book tomorrow, log a note.
    for (const lead of leads) {
      if (changes.length >= AUTOMATION_CAP) break;
      if (String(lead.temperature ?? "").trim().toLowerCase() !== "warm") continue;
      const inactive = daysSinceIso(lead.updated_at, todayKey);
      if (inactive === null || inactive < 7) continue;
      changes.push({
        leadId: lead.id,
        name: lead.name,
        phone: lead.phone,
        assignedTo: lead.assigned_to,
        patch: {
          followUpDate: addDaysKey(todayKey, 1),
          note: "Automation nudge: 7+ days without activity — callback re-booked.",
        },
        reason: `Inactive ${inactive} days — re-booked for tomorrow`,
      });
    }
    return { changes, scanned: leads.length };
  }


  if (ruleKey === "overdue") {
    // Missed follow-ups on hot leads: re-book tomorrow + log the escalation.
    for (const lead of leads) {
      if (changes.length >= AUTOMATION_CAP) break;
      if (String(lead.temperature ?? "").trim().toLowerCase() !== "hot") continue;
      if (!isStaleFollowUp(lead.follow_up_date, todayKey)) continue;
      changes.push({
        leadId: lead.id,
        name: lead.name,
        phone: lead.phone,
        assignedTo: lead.assigned_to,
        patch: {
          followUpDate: addDaysKey(todayKey, 1),
          note: "Automation: overdue follow-up escalated + re-booked for tomorrow.",
        },
        reason: "Overdue follow-up on a hot lead — escalated + re-booked",
      });
    }
    return { changes, scanned: leads.length };
  }

  if (ruleKey === "balance") {
    // Unassigned open leads: round-robin across agents so no queue starves.
    const actionable = agents.length > 0 ? agents : ["-"];
    let cursor = 0;
    for (const lead of leads) {
      if (changes.length >= AUTOMATION_CAP) break;
      const assigned = String(lead.assigned_to ?? "").trim();
      if (assigned && assigned !== "-") continue;
      const status = String(lead.status ?? "").trim().toLowerCase();
      if (status === "lost" || status === "dropped" || status === "surgery completed" || status === "won") continue;
      const agent = actionable[cursor % actionable.length];
      cursor += 1;
      changes.push({
        leadId: lead.id,
        name: lead.name,
        phone: lead.phone,
        assignedTo: lead.assigned_to,
        patch: { assignedTo: agent },
        reason: `Unassigned — round-robin to ${agent}`,
      });
    }
    return { changes, scanned: leads.length };
  }

  // celebrate: surgery completions get warmth + a win note on the timeline.
  for (const lead of leads) {
    if (changes.length >= AUTOMATION_CAP) break;
    if (String(lead.status ?? "").trim().toLowerCase() !== "surgery completed") continue;
    changes.push({
      leadId: lead.id,
      name: lead.name,
      phone: lead.phone,
      assignedTo: lead.assigned_to,
      patch: { temperature: "Hot", note: "Automation: surgery completed — marked as a win." },
      reason: "Surgery completed — celebrated",
    });
  }
  return { changes, scanned: leads.length };
}
