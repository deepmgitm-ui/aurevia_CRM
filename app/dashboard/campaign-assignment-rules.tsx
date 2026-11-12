"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Pencil, RotateCcw, Save, Users } from "lucide-react";

import {
  getCampaignAssignmentSetup,
  saveCampaignAssignmentRule,
  setCampaignAssignmentRuleActive,
  type CampaignOption,
  type CampaignRoute,
} from "@/app/actions/campaign-assignment";

type Employee = { id: string; name: string };

export function CampaignAssignmentRules() {
  const [role, setRole] = useState<"admin" | "manager" | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [routes, setRoutes] = useState<CampaignRoute[]>([]);
  const [metaConnected, setMetaConnected] = useState(false);
  const [metaCampaignError, setMetaCampaignError] = useState<string | null>(null);
  const [campaignName, setCampaignName] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [formId, setFormId] = useState("");
  const [targetProfileIds, setTargetProfileIds] = useState<string[]>([]);
  const [assignmentMode, setAssignmentMode] = useState<"round_robin" | "manual">("round_robin");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const applySetup = useCallback((result: Awaited<ReturnType<typeof getCampaignAssignmentSetup>>) => {
    if (!result.success) {
      setError(result.error);
      return;
    }
    setRole(result.data.role);
    setEmployees(result.data.employees);
    setCampaigns(result.data.campaigns);
    setRoutes(result.data.routes);
    setMetaConnected(result.data.metaConnected);
    setMetaCampaignError(result.data.metaCampaignError);
    setError("");
  }, []);

  const load = useCallback(async () => {
    applySetup(await getCampaignAssignmentSetup());
  }, [applySetup]);

  useEffect(() => {
    let active = true;
    void getCampaignAssignmentSetup().then((result) => {
      if (!active) return;
      applySetup(result);
      const params = new URLSearchParams(window.location.search);
      const metaStatus = params.get("meta");
      if (metaStatus === "connected") setNotice("Meta connected. Your campaigns are ready to select.");
      if (metaStatus === "setup") setError("Meta connection needs setup. Add the Meta app details and token encryption key to the hosting environment, then try again.");
      if (metaStatus === "admin-only") setError("Only an admin can connect Meta.");
      if (["cancelled", "state-error", "connect-error"].includes(metaStatus ?? "")) {
        setError(params.get("detail") || "Meta connection did not finish. Try connecting again.");
      }
    });
    return () => { active = false; };
  }, [applySetup]);

  function resetForm() {
    setCampaignName("");
    setCampaignId("");
    setFormId("");
    setTargetProfileIds([]);
    setAssignmentMode("round_robin");
    setEditingId(null);
  }

  function toggleTarget(profileId: string) {
    setTargetProfileIds((current) => current.includes(profileId)
      ? current.filter((id) => id !== profileId)
      : [...current, profileId]);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const result = await saveCampaignAssignmentRule({
      id: editingId ?? undefined,
      campaignName,
      campaignId,
      formId,
      targetProfileIds,
      assignmentMode,
    });
    setBusy(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setNotice("Campaign route saved.");
    resetForm();
    await load();
  }

  async function toggleRoute(route: CampaignRoute) {
    setBusy(true);
    setError("");
    const result = await setCampaignAssignmentRuleActive(route.id, !route.isActive);
    setBusy(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setRoutes((current) => current.map((item) => item.id === route.id ? { ...item, isActive: !route.isActive } : item));
    setNotice(route.isActive ? "Campaign route paused." : "Campaign route resumed.");
  }

  function edit(route: CampaignRoute) {
    setEditingId(route.id);
    setCampaignName(route.campaignName);
    setCampaignId(route.campaignId ?? "");
    setFormId(route.formId ?? "");
    setTargetProfileIds(route.targetProfileIds);
    setAssignmentMode(route.assignmentMode);
    setNotice("");
  }

  return (
    <section className="space-y-5 rounded-2xl border border-blue-900/10 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="campaign-routing-title">
      <div className="flex items-start gap-3">
        <span className="rounded-xl bg-blue-50 p-2 text-blue-800"><Users className="size-5" aria-hidden="true" /></span>
        <div className="min-w-0">
          <h2 id="campaign-routing-title" className="text-lg font-semibold text-slate-950">Meta campaign lead routing</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">Choose a campaign and the agents who should receive its leads. Round-robin gives each lead one owner in turn; admin review leaves the lead unassigned for your team to distribute.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-blue-900/10 bg-blue-50/50 p-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">{metaConnected ? "Meta account connected" : "Connect your Meta account once"}</p>
          <p className="mt-1 text-sm text-slate-600">{metaConnected ? `${campaigns.length} active campaigns available to assign.` : "After connecting, choose campaigns here and assign their incoming leads to agents."}</p>
          {metaCampaignError && <p role="status" className="mt-2 break-words text-sm text-amber-800">{metaCampaignError}</p>}
        </div>
        {role === "admin" && (
          <>
            <a href="/api/meta/connect" className="inline-flex min-h-10 items-center rounded-lg bg-blue-800 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2">{metaConnected ? "Reconnect Meta" : "Connect to Meta"}</a>
            {metaConnected && <button type="button" disabled={busy} onClick={() => void load()} className="inline-flex min-h-10 items-center rounded-lg border border-blue-800/25 bg-white px-4 py-2 text-sm font-medium text-blue-900 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 disabled:opacity-50">Refresh campaigns</button>}
          </>
        )}
      </div>

      {role === "admin" && (
        <form onSubmit={save} className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1.5 text-sm font-medium text-slate-800">
              Campaign
              <select
                value=""
                onChange={(event) => {
                  const option = campaigns.find((item) => `${item.id ?? ""}|${item.name}` === event.target.value);
                  if (!option) return;
                  setCampaignName(option.name);
                  setCampaignId(option.id ?? "");
                }}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
              >
              <option value="">{!metaConnected ? "Connect Meta to list active campaigns…" : campaigns.length ? "Choose an active Meta campaign…" : "No active campaigns found…"}</option>
                {campaigns.map((item) => (
                  <option key={`${item.id ?? "name"}:${item.name}`} value={`${item.id ?? ""}|${item.name}`}>
                  {item.name}{item.status === "ACTIVE" ? " · Active" : ""}{item.id ? ` · ${item.id}` : ""}
                  </option>
                ))}
              </select>
              <span className="block text-xs font-normal text-slate-500">After connecting Meta, only campaigns Meta marks active appear here, including those with no leads yet.</span>
            </label>
            <label className="space-y-1.5 text-sm font-medium text-slate-800">
              Exact campaign name
              <input
                required
                maxLength={160}
                value={campaignName}
                onChange={(event) => setCampaignName(event.target.value)}
                placeholder="e.g. Pune ENT Consultation"
                autoComplete="off"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium text-slate-800">
              Campaign ID <span className="font-normal text-slate-500">(optional, exact matching)</span>
              <input
                maxLength={200}
                value={campaignId}
                onChange={(event) => setCampaignId(event.target.value)}
                placeholder="Meta campaign ID"
                autoComplete="off"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium text-slate-800">
              Form ID <span className="font-normal text-slate-500">(optional, limit this route to one form)</span>
              <input
                maxLength={200}
                value={formId}
                onChange={(event) => setFormId(event.target.value)}
                placeholder="Meta lead form ID"
                autoComplete="off"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
              />
            </label>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-slate-800">Agents for this campaign</legend>
            {employees.length === 0 ? (
              <p className="text-sm text-slate-500">No agents are available to select.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {employees.map((employee) => (
                  <label key={employee.id} className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:border-blue-300">
                    <input
                      type="checkbox"
                      checked={targetProfileIds.includes(employee.id)}
                      onChange={() => toggleTarget(employee.id)}
                      className="size-4 rounded border-slate-300 text-blue-700 focus-visible:ring-2 focus-visible:ring-blue-700"
                    />
                    <span className="min-w-0 break-words">{employee.name}</span>
                  </label>
                ))}
              </div>
            )}
            <p className="text-xs text-slate-500">Select at least one. Up to 20 agents can share a campaign.</p>
          </fieldset>

          <fieldset className="grid gap-2 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-medium text-slate-800">How should new leads be assigned?</legend>
            <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">
              <input type="radio" name="campaign-assignment-mode" checked={assignmentMode === "round_robin"} onChange={() => setAssignmentMode("round_robin")} className="mt-0.5 size-4 border-slate-300 text-blue-700 focus-visible:ring-2 focus-visible:ring-blue-700" />
              <span><span className="block font-medium text-slate-900">Round-robin</span><span className="mt-0.5 block text-xs leading-5 text-slate-500">Each lead gets one selected agent, balanced in turn.</span></span>
            </label>
            <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">
              <input type="radio" name="campaign-assignment-mode" checked={assignmentMode === "manual"} onChange={() => setAssignmentMode("manual")} className="mt-0.5 size-4 border-slate-300 text-blue-700 focus-visible:ring-2 focus-visible:ring-blue-700" />
              <span><span className="block font-medium text-slate-900">Admin assigns manually</span><span className="mt-0.5 block text-xs leading-5 text-slate-500">Leads arrive as New and unassigned; admins choose the owner in Leads.</span></span>
            </label>
          </fieldset>

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy || !campaignName.trim() || !targetProfileIds.length} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-blue-800 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
              <Save className="size-4" aria-hidden="true" />{busy ? "Saving…" : editingId ? "Update campaign route" : "Save campaign route"}
            </button>
            {editingId && <button type="button" onClick={resetForm} disabled={busy} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 disabled:opacity-50"><RotateCcw className="size-4" aria-hidden="true" />Cancel edit</button>}
          </div>
        </form>
      )}

      {role === "manager" && <p className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">You can review campaign routes here. Only admins can change them.</p>}
      <div className="space-y-3" aria-live="polite">
        {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
        {notice && <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">{notice}</p>}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">Saved campaign routes</h3>
        {routes.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">No campaign routes yet. Add a campaign above; its Meta leads will then follow that route.</p>
        ) : routes.map((route) => (
          <article key={route.id} className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="break-words font-medium text-slate-900">{route.campaignName}</h4>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${route.isActive ? "bg-blue-50 text-blue-800" : "bg-slate-100 text-slate-600"}`}>{route.isActive ? "Active" : "Paused"}</span>
              </div>
              <p className="break-words text-sm text-slate-600">{route.targetNames.join(", ") || "No agents selected"}</p>
              <p className="text-xs text-slate-500">{route.assignmentMode === "round_robin" ? "Round-robin · one owner per lead" : "Admin assigns manually"}{route.campaignId ? ` · Campaign ${route.campaignId}` : " · matched by campaign name"}{route.formId ? ` · Form ${route.formId}` : ""}</p>
            </div>
            {role === "admin" && (
              <div className="flex shrink-0 flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => edit(route)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 disabled:opacity-50"><Pencil className="size-3.5" aria-hidden="true" />Edit</button>
                <button type="button" disabled={busy} aria-pressed={!route.isActive} onClick={() => void toggleRoute(route)} className="min-h-9 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 disabled:opacity-50">{route.isActive ? "Pause route" : "Resume route"}</button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
