"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

type AssignmentMode = "round_robin" | "manual";

export type CampaignOption = { id: string | null; name: string };
export type CampaignRoute = {
  id: string;
  campaignId: string | null;
  campaignName: string;
  formId: string | null;
  targetProfileIds: string[];
  targetNames: string[];
  assignmentMode: AssignmentMode;
  isActive: boolean;
  updatedAt: string;
};

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanText(value: unknown, limit: number): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, limit) : "";
}

async function getTeamViewer() {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return { supabase, user: null, role: null, error: "Sign in to manage campaign routing." };
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profileError || !profile || !["admin", "manager"].includes(profile.role)) {
    return { supabase, user: null, role: null, error: "Campaign routing is available to admins and managers." };
  }
  return { supabase, user, role: profile.role, error: null };
}

function campaignNameFromLabel(label: string): string {
  return label
    .replace(/^Meta Ads\s*[—–-]\s*/i, "")
    .split(/\s+·\s+Form\s+/i, 1)[0]
    .trim();
}

export async function getCampaignAssignmentSetup(): Promise<ActionResult<{
  role: "admin" | "manager";
  employees: { id: string; name: string }[];
  campaigns: CampaignOption[];
  routes: CampaignRoute[];
}>> {
  try {
    const viewer = await getTeamViewer();
    if (viewer.error || !viewer.user || !viewer.role) return { success: false, error: viewer.error ?? "Sign in to continue." };

    const [employeeResult, routeResult, leadCampaignResult] = await Promise.all([
      viewer.supabase.from("profiles").select("id, name").eq("role", "employee").order("name"),
      viewer.supabase
        .from("crm_campaign_assignment_rules")
        .select("id, campaign_id, campaign_name, form_id, target_profile_ids, assignment_mode, is_active, updated_at")
        .order("updated_at", { ascending: false }),
      viewer.supabase
        .from("leads")
        .select("meta_campaign_id, meta_campaign_name, source_batch_label")
        .eq("source", "Meta Ads")
        .not("source_batch_label", "is", null)
        .limit(2_000),
    ]);
    if (employeeResult.error || routeResult.error || leadCampaignResult.error) {
      return { success: false, error: "Campaign routing could not be loaded. Refresh to try again." };
    }

    const employees = (employeeResult.data ?? []).map((row) => ({ id: row.id, name: row.name }));
    const employeeNames = new Map(employees.map((employee) => [employee.id, employee.name]));
    const routes = (routeResult.data ?? []).map((row) => {
      const targetProfileIds = Array.isArray(row.target_profile_ids)
        ? row.target_profile_ids.filter((id): id is string => typeof id === "string")
        : [];
      return {
        id: row.id,
        campaignId: row.campaign_id,
        campaignName: row.campaign_name,
        formId: row.form_id,
        targetProfileIds,
        targetNames: targetProfileIds.map((id) => employeeNames.get(id) ?? "Team member unavailable"),
        assignmentMode: row.assignment_mode as AssignmentMode,
        isActive: row.is_active,
        updatedAt: row.updated_at,
      };
    });

    const campaignsByKey = new Map<string, CampaignOption>();
    for (const row of leadCampaignResult.data ?? []) {
      const name = cleanText(row.meta_campaign_name, 160) || campaignNameFromLabel(row.source_batch_label ?? "");
      if (!name || name === "Meta Ads") continue;
      const id = cleanText(row.meta_campaign_id, 200) || null;
      const key = id ? `id:${id}` : `name:${name.toLowerCase()}`;
      campaignsByKey.set(key, { id, name });
    }
    for (const route of routes) {
      const key = route.campaignId ? `id:${route.campaignId}` : `name:${route.campaignName.toLowerCase()}`;
      if (!campaignsByKey.has(key)) campaignsByKey.set(key, { id: route.campaignId, name: route.campaignName });
    }

    return {
      success: true,
      data: {
        role: viewer.role as "admin" | "manager",
        employees,
        campaigns: [...campaignsByKey.values()].sort((a, b) => a.name.localeCompare(b.name)),
        routes,
      },
    };
  } catch {
    return { success: false, error: "Campaign routing could not be loaded. Refresh to try again." };
  }
}

export async function saveCampaignAssignmentRule(input: {
  id?: string;
  campaignId?: string;
  campaignName: string;
  formId?: string;
  targetProfileIds: string[];
  assignmentMode: AssignmentMode;
}): Promise<ActionResult<{ id: string }>> {
  const campaignName = cleanText(input?.campaignName, 160);
  const campaignId = cleanText(input?.campaignId, 200) || null;
  const formId = cleanText(input?.formId, 200) || null;
  const targetProfileIds = Array.isArray(input?.targetProfileIds)
    ? [...new Set(input.targetProfileIds.filter((id) => typeof id === "string" && UUID_PATTERN.test(id)))]
    : [];
  const assignmentMode = input?.assignmentMode;
  if (!campaignName || (input.id && !UUID_PATTERN.test(input.id))) {
    return { success: false, error: "Choose a campaign and try again." };
  }
  if (input.campaignId && !campaignId) return { success: false, error: "Campaign ID must be 200 characters or fewer." };
  if (input.formId && !formId) return { success: false, error: "Form ID must be 200 characters or fewer." };
  if (targetProfileIds.length < 1 || targetProfileIds.length > 20 || !["round_robin", "manual"].includes(assignmentMode)) {
    return { success: false, error: "Choose 1–20 agents and a valid assignment method." };
  }

  try {
    const viewer = await getTeamViewer();
    if (viewer.error || !viewer.user || viewer.role !== "admin") {
      return { success: false, error: "Only admins can change campaign routing." };
    }

    const { data: targets, error: targetError } = await viewer.supabase
      .from("profiles")
      .select("id")
      .eq("role", "employee")
      .in("id", targetProfileIds);
    if (targetError || (targets ?? []).length !== targetProfileIds.length) {
      return { success: false, error: "One or more selected agents are no longer available." };
    }

    const nameKey = campaignName.toLowerCase();
    let nextTargetIndex = 0;
    if (input.id) {
      const { data: previous, error: previousError } = await viewer.supabase
        .from("crm_campaign_assignment_rules")
        .select("target_profile_ids, next_target_index, is_active")
        .eq("id", input.id)
        .single();
      if (previousError || !previous) return { success: false, error: "This campaign route no longer exists. Refresh and try again." };
      const previousIds = Array.isArray(previous.target_profile_ids) ? previous.target_profile_ids : [];
      if (previousIds.length === targetProfileIds.length && previousIds.every((id, index) => id === targetProfileIds[index])) {
        nextTargetIndex = Number(previous.next_target_index) || 0;
      }
      const { error } = await viewer.supabase
        .from("crm_campaign_assignment_rules")
        .update({
          campaign_id: campaignId,
          campaign_name: campaignName,
          campaign_name_key: nameKey,
          form_id: formId,
          target_profile_ids: targetProfileIds,
          assignment_mode: assignmentMode,
          next_target_index: nextTargetIndex,
          is_active: previous.is_active,
          updated_at: new Date().toISOString(),
        })
        .eq("id", input.id);
      if (error) return { success: false, error: /unique/i.test(error.message) ? "A route already exists for this campaign." : "Campaign routing could not be saved." };
      revalidatePath("/dashboard/marketing");
      return { success: true, data: { id: input.id } };
    }

    const { data: created, error } = await viewer.supabase
      .from("crm_campaign_assignment_rules")
      .insert({
        campaign_id: campaignId,
        campaign_name: campaignName,
        campaign_name_key: nameKey,
        form_id: formId,
        target_profile_ids: targetProfileIds,
        assignment_mode: assignmentMode,
        created_by: viewer.user.id,
      })
      .select("id")
      .single();
    if (error || !created) return { success: false, error: /unique/i.test(error?.message ?? "") ? "A route already exists for this campaign." : "Campaign routing could not be saved." };
    revalidatePath("/dashboard/marketing");
    return { success: true, data: { id: created.id } };
  } catch {
    return { success: false, error: "Campaign routing could not be saved." };
  }
}

export async function setCampaignAssignmentRuleActive(id: string, isActive: boolean): Promise<ActionResult<null>> {
  if (!UUID_PATTERN.test(id) || typeof isActive !== "boolean") {
    return { success: false, error: "Choose a valid campaign route." };
  }
  try {
    const viewer = await getTeamViewer();
    if (viewer.error || !viewer.user || viewer.role !== "admin") {
      return { success: false, error: "Only admins can change campaign routing." };
    }
    const { error } = await viewer.supabase
      .from("crm_campaign_assignment_rules")
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return { success: false, error: "Campaign routing could not be updated." };
    revalidatePath("/dashboard/marketing");
    return { success: true, data: null };
  } catch {
    return { success: false, error: "Campaign routing could not be updated." };
  }
}
