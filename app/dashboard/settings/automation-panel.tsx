// Aurevia CRM — Settings → Automation.
//
// Admins preview a rule (what would change, no writes), run it (bounded, with
// an audit receipt), and see the history of what the robot did. Employees never
// see this panel: the server actions reject anyone who is not admin/manager.
"use client";

import { useCallback, useEffect, useState } from "react";

import {
  getAutomationRuns,
  getAutomationRules,
  previewAutomation,
  runAutomation,
  setAutomationRuleEnabled,
  type AutomationChange,
  type AutomationRule,
  type AutomationRunLog,
} from "@/app/actions/automation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Play, Wand2 } from "lucide-react";
import { toast } from "@/components/ui/toast";

export function AutomationPanel() {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [runs, setRuns] = useState<AutomationRunLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingRule, setPendingRule] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    rule: AutomationRule;
    changes: AutomationChange[];
    scanned: number;
  } | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [runningRule, setRunningRule] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [rulesResult, runsResult] = await Promise.all([getAutomationRules(), getAutomationRuns()]);
    if (rulesResult.success && rulesResult.data) setRules(rulesResult.data);
    if (runsResult.success && runsResult.data) setRuns(runsResult.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void Promise.all([getAutomationRules(), getAutomationRuns()]).then(([rulesResult, runsResult]) => {
      if (rulesResult.success && rulesResult.data) setRules(rulesResult.data);
      if (runsResult.success && runsResult.data) setRuns(runsResult.data);
      setLoading(false);
    });
  }, []);

  async function handlePreview(rule: AutomationRule) {
    setPendingRule(rule.key);
    const response = await previewAutomation(rule.key);
    setPendingRule(null);
    if (!response.success) {
      toast.add({ title: "Preview failed", description: response.error, type: "error" });
      return;
    }
    setPreview(response.data ?? null);
    setIsPreviewOpen(true);
  }

  async function handleRun(rule: AutomationRule) {
    setRunningRule(rule.key);
    const response = await runAutomation(rule.key);
    setRunningRule(null);
    if (!response.success) {
      toast.add({ title: "Run failed", description: response.error, type: "error" });
      return;
    }
    const affected = response.data?.affected ?? 0;
    toast.add({
      title: "Automation finished",
      description: `${affected} lead${affected === 1 ? "" : "s"} updated — see the receipt below.`,
      type: "success",
    });
    await refresh();
  }

  async function handleToggle(rule: AutomationRule) {
    const next = !rule.enabled;
    setRules((current) =>
      current.map((entry) => (entry.key === rule.key ? { ...entry, enabled: next } : entry)),
    );
    const response = await setAutomationRuleEnabled(rule.key, next);
    if (!response.success) {
      setRules((current) =>
        current.map((entry) => (entry.key === rule.key ? { ...entry, enabled: !next } : entry)),
      );
      toast.add({ title: "Unable to change rule", description: response.error, type: "error" });
      return;
    }
    toast.add({
      title: next ? "Rule enabled" : "Rule disabled",
      description: rule.label,
      type: "success",
    });
  }

  if (loading) {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="flex items-center gap-2 py-8 text-sm text-slate-500">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading automation rules...
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-lg">Workflow Automation</CardTitle>
              <p className="mt-1 text-sm text-slate-500">
                Preview first — the robot never surprises you. Runs are capped at 200 leads and leave a receipt.
              </p>
            </div>
            <Badge className="border-indigo-200 bg-indigo-100 text-indigo-700 hover:bg-indigo-100">
              Admin / Manager
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {rules.length === 0 && (
            <p className="text-sm text-slate-500">
              Rules could not be loaded. Run{" "}
              <span className="font-mono text-xs">supabase-automation-migration.sql</span> in the Supabase SQL editor.
            </p>
          )}
          {rules.map((rule) => (
            <div
              key={rule.key}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">{rule.label}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {rule.lastRunAt
                    ? `Last run ${new Date(rule.lastRunAt).toLocaleString()} · ${rule.lastRunSummary || "no changes"}`
                    : "Never run"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  role="switch"
                  aria-checked={rule.enabled}
                  aria-label={`${rule.enabled ? "Disable" : "Enable"} ${rule.label}`}
                  onClick={() => void handleToggle(rule)}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                    rule.enabled ? "bg-emerald-500" : "bg-slate-300"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${
                      rule.enabled ? "left-[22px]" : "left-0.5"
                    }`}
                  />
                </button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!rule.enabled || pendingRule === rule.key || runningRule === rule.key}
                  onClick={() => void handlePreview(rule)}
                >
                  {pendingRule === rule.key ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Wand2 className="size-3.5" aria-hidden="true" />
                  )}
                  Preview
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={!rule.enabled || runningRule === rule.key}
                  onClick={() => void handleRun(rule)}
                >
                  {runningRule === rule.key ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Play className="size-3.5" aria-hidden="true" />
                  )}
                  Run now
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">Run history</CardTitle>
          <p className="mt-1 text-sm text-slate-500">Every run, what it touched, and who triggered it.</p>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-slate-500">No runs yet.</p>
          ) : (
            <ul className="space-y-2">
              {runs.map((run) => (
                <li
                  key={run.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm"
                >
                  <span className="font-medium text-slate-800">{run.ruleKey}</span>
                  <span className="text-slate-600">{run.affected} leads</span>
                  <span className="text-xs text-slate-500">
                    by {run.runByName} · {new Date(run.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Preview: {preview?.rule.label ?? "Automation"}</DialogTitle>
            <DialogDescription>
              {preview
                ? `${preview.changes.length} lead${preview.changes.length === 1 ? "" : "s"} would change (scanned ${preview.scanned}). Nothing is written yet.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {preview && preview.changes.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing matches right now — nothing to change.</p>
          ) : (
            <ul className="max-h-72 space-y-2 overflow-y-auto">
              {preview?.changes.map((change) => (
                <li key={change.leadId} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
                  <p className="font-medium text-slate-900">{change.name || "Unnamed lead"}</p>
                  <p className="text-xs text-slate-600">{change.reason}</p>
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsPreviewOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
