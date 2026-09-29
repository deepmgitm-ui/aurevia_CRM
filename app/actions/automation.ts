// Aurevia CRM — workflow automation (if-this-then-that rules).
//
// The app itself is the rule engine: `previewAutomation` shows EXACTLY what a
// run would change (no writes), `runAutomation` applies them in bounded chunks
// and writes a receipt to `crm_automation_runs` — so the robot stays auditable.
// Rules only ever touch status, temperature, assigned_to and follow-up/activity
// rows, and NEVER delete.
"use server";

import { createClient } from "@/lib/supabase/server";
import {
  ALL_RULES,
  AUTOMATION_CAP,
  AUTOMATION_SCAN,
  matchChanges,
  type AutomationChange,
  type AutomationRuleKey,
  type LeadLite,
} from "@/lib/automation";

export type { AutomationChange, AutomationRuleKey } from "@/lib/automation";

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}


export interface AutomationRule {
  key: AutomationRuleKey;
  label: string;
  stage: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastRunSummary: string;
}

export interface AutomationPreview {
  rule: AutomationRule;
  changes: AutomationChange[];
  scanned: number;
  capped: boolean;
}

export interface AutomationToggleResponse {
  success: boolean;
  error?: string;
}

export interface AutomationPreviewResponse {
  success: boolean;
  data?: AutomationPreview;
  error?: string;
}

export interface AutomationRunReceipt {
  ruleKey: string;
  affected: number;
  skipped: number;
  summary: string;
}

export interface AutomationRunLog {
  id: string;
  ruleKey: string;
  runByName: string;
  affected: number;
  createdAt: string;
}

export interface AutomationRunResponse {
  success: boolean;
  data?: AutomationRunReceipt;
  error?: string;
}

export interface AutomationRunsResponse {
  success: boolean;
  data?: AutomationRunLog[];
  error?: string;
}


function missingTableError(error: { code?: string | null; message?: string | null } | null): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST204") return true;
  const message = (error.message ?? "").toLowerCase();
  return (
    message.includes("could not find the table") ||
    message.includes("does not exist") ||
    message.includes("schema cache")
  );
}

async function getViewerRole(supabase: AutomationSupabase): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  return profile?.role ?? null;
}

async function readRules(supabase: AutomationSupabase): Promise<AutomationRule[]> {
  const seeded: AutomationRule[] = ALL_RULES.map((rule) => ({
    ...rule,
    enabled: true,
    lastRunAt: null,
    lastRunSummary: "",
  }));
  const { data, error } = await supabase
    .from("crm_automation_rules")
    .select("key, label, stage, enabled, last_run_at, last_run_summary");
  if (error || !data) return seeded;
  const byKey = new Map(
    (data as Record<string, unknown>[]).map((row) => [
      String(row.key ?? ""),
      {
        key: String(row.key ?? "") as AutomationRuleKey,
        label: String(row.label ?? ""),
        stage: String(row.stage ?? ""),
        enabled: Boolean(row.enabled ?? true),
        lastRunAt: row.last_run_at ? String(row.last_run_at) : null,
        lastRunSummary: String(row.last_run_summary ?? ""),
      } satisfies AutomationRule,
    ]),
  );
  return ALL_RULES.map(
    (rule) => byKey.get(rule.key) ?? { ...rule, enabled: true, lastRunAt: null, lastRunSummary: "" },
  );
}

async function scanLeads(supabase: AutomationSupabase): Promise<LeadLite[]> {
  const { data, error } = await supabase
    .from("leads")
    .select("id, name, phone, status, temperature, assigned_to, follow_up_date, updated_at")
    .order("updated_at", { ascending: false })
    .limit(AUTOMATION_SCAN);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as LeadLite[];
}

async function readAgents(supabase: AutomationSupabase): Promise<string[]> {
  const { data } = await supabase.from("profiles").select("name").order("name", { ascending: true });
  return ((data ?? []) as { name: string }[])
    .map((row) => String(row.name ?? "").trim())
    .filter(Boolean);
}



type AutomationSupabase = Awaited<ReturnType<typeof createClient>>;


// The five rules with their DB state (label, enabled, last run).
export async function getAutomationRules(): Promise<{
  success: boolean;
  data?: AutomationRule[];
  error?: string;
}> {
  try {
    const supabase = await createClient();
    const role = await getViewerRole(supabase);
    if (role !== "admin" && role !== "manager") {
      return { success: false, error: "Only admins and managers can view automations (403 Forbidden)." };
    }
    return { success: true, data: await readRules(supabase) };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Unable to load automation rules.") };
  }
}

// Turn a rule on/off (admins/managers only). A disabled rule is skipped by
// preview and run — the robot only ever acts on rules the team left switched on.
export async function setAutomationRuleEnabled(
  ruleKey: AutomationRuleKey,
  enabled: boolean,
): Promise<AutomationToggleResponse> {
  try {
    const supabase = await createClient();
    const role = await getViewerRole(supabase);
    if (role !== "admin" && role !== "manager") {
      return { success: false, error: "Only admins and managers can change automations (403 Forbidden)." };
    }
    const { error } = await supabase.from("crm_automation_rules").update({ enabled }).eq("key", ruleKey);
    if (error) {
      return missingTableError(error)
        ? {
            success: false,
            error:
              "Automation is not set up yet. Run supabase-automation-migration.sql in the Supabase SQL editor first.",
          }
        : { success: false, error: error.message };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Unable to update the rule.") };
  }
}

// What a run WOULD change — no writes at all.
export async function previewAutomation(ruleKey: AutomationRuleKey): Promise<AutomationPreviewResponse> {
  try {
    const supabase = await createClient();
    const role = await getViewerRole(supabase);
    if (role !== "admin" && role !== "manager") {
      return { success: false, error: "Only admins and managers can run automations (403 Forbidden)." };
    }
    const rules = await readRules(supabase);
    const rule = rules.find((entry) => entry.key === ruleKey);
    if (!rule) return { success: false, error: "Unknown automation rule." };
    if (!rule.enabled) return { success: false, error: "This rule is switched off. Enable it first." };
    const [leads, agents] = await Promise.all([scanLeads(supabase), readAgents(supabase)]);
    const { changes, scanned } = matchChanges(ruleKey, leads, agents);
    return { success: true, data: { rule, changes, scanned, capped: changes.length >= AUTOMATION_CAP } };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Unable to preview the automation.") };
  }
}

// Applies ONE rule (bounded), then writes a receipt to crm_automation_runs.
export async function runAutomation(ruleKey: AutomationRuleKey): Promise<AutomationRunResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "You must be signed in." };
    const { data: profile } = await supabase.from("profiles").select("role, name").eq("id", user.id).single();
    if (profile?.role !== "admin" && profile?.role !== "manager") {
      return { success: false, error: "Only admins and managers can run automations (403 Forbidden)." };
    }
    const ruleState = (await readRules(supabase)).find((entry) => entry.key === ruleKey);
    if (ruleState && !ruleState.enabled) {
      return { success: false, error: "This rule is switched off. Enable it first." };
    }
    const [leads, agents] = await Promise.all([scanLeads(supabase), readAgents(supabase)]);
    const { changes } = matchChanges(ruleKey, leads, agents);

    let affected = 0;
    for (const change of changes) {
      const payload: Record<string, string> = {};
      if (change.patch.temperature) payload.temperature = change.patch.temperature;
      if (change.patch.assignedTo) payload.assigned_to = change.patch.assignedTo;
      if (change.patch.followUpDate) payload.follow_up_date = change.patch.followUpDate;
      if (Object.keys(payload).length > 0) {
        const { error } = await supabase.from("leads").update(payload).eq("id", change.leadId);
        if (error) continue;
      }
      if (change.patch.note) {
        await supabase.from("lead_activities").insert({
          lead_id: change.leadId,
          user_id: user.id,
          action_type: "automation",
          description: change.patch.note,
        });
      }
      affected += 1;
    }

    const runByName = profile?.name?.trim() || "-";
    const summary = `${affected} lead${affected === 1 ? "" : "s"} updated`;
    // Receipt is best-effort: a missing migration must never fail the run itself.
    await supabase.from("crm_automation_runs").insert({
      rule_key: ruleKey,
      run_by: user.id,
      run_by_name: runByName,
      affected,
      detail: changes.slice(0, AUTOMATION_CAP).map((change) => ({
        lead_id: change.leadId,
        name: change.name,
        patch: change.patch,
        reason: change.reason,
      })),
    });
    await supabase
      .from("crm_automation_rules")
      .update({ last_run_at: new Date().toISOString(), last_run_summary: summary })
      .eq("key", ruleKey);

    return { success: true, data: { ruleKey, affected, skipped: changes.length - affected, summary } };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Unable to run the automation.") };
  }
}

// Latest receipts, newest first — "the robot did what, exactly?"
export async function getAutomationRuns(): Promise<AutomationRunsResponse> {
  try {
    const supabase = await createClient();
    const role = await getViewerRole(supabase);
    if (role !== "admin" && role !== "manager") {
      return { success: false, error: "Only admins and managers can view automations (403 Forbidden)." };
    }
    const { data, error } = await supabase
      .from("crm_automation_runs")
      .select("id, rule_key, run_by_name, affected, created_at")
      .order("created_at", { ascending: false })
      .limit(25);
    if (error) {
      return missingTableError(error) ? { success: true, data: [] } : { success: false, error: error.message };
    }
    return {
      success: true,
      data: ((data ?? []) as Record<string, string | number | null>[]).map((row) => ({
        id: String(row.id ?? ""),
        ruleKey: String(row.rule_key ?? "-"),
        runByName: String(row.run_by_name ?? "-"),
        affected: Number(row.affected ?? 0),
        createdAt: String(row.created_at ?? ""),
      })),
    };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Unable to load automation history.") };
  }
}
