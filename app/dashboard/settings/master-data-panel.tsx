// Aurevia CRM — Settings → Master Data.
//
// Admins edit the picklist options (statuses, treatments, sources, cities,
// temperatures) as plain one-value-per-line text. Until
// `supabase-master-data-migration.sql` has been applied the reads fall back to
// the seed, so the panel is clearly marked read-only instead of pretending a
// save worked.
"use client";

import { useState } from "react";

import { saveMasterDataList, getMasterData } from "@/app/actions/master-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import {
  MASTER_DATA_LISTS,
  type MasterDataListKey,
  type MasterDataSnapshot,
} from "@/lib/master-data";

const LIST_META: Record<MasterDataListKey, { title: string; hint: string }> = {
  statuses: {
    title: "Lead statuses",
    hint: "Dropdown options for the Status column (and the pipeline board columns).",
  },
  treatments: {
    title: "Treatments",
    hint: "Offered when adding/editing a lead's Treatment / Disease.",
  },
  sources: {
    title: "Lead sources",
    hint: "Where leads come from — shown in the Source column and filters.",
  },
  cities: {
    title: "Cities",
    hint: "Common service areas; the current value of a lead is always kept.",
  },
  temperatures: {
    title: "Temperatures",
    hint: "Hot / Warm / Cold labels used for lead heat.",
  },
};

export function MasterDataPanel({ initial }: { initial: MasterDataSnapshot }) {
  const [snapshot, setSnapshot] = useState<MasterDataSnapshot>(initial);
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      MASTER_DATA_LISTS.map((key) => [key, (initial.lists[key] ?? []).join("\n")]),
    ),
  );
  const [savingKey, setSavingKey] = useState<MasterDataListKey | null>(null);

  async function handleSave(key: MasterDataListKey) {
    setSavingKey(key);
    const options = drafts[key] ?? "";
    const parsed = options
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const response = await saveMasterDataList(key, parsed);
    setSavingKey(null);

    if (!response.success) {
      toast.add({ title: "Unable to save list", description: response.error, type: "error" });
      return;
    }

    const refreshed = await getMasterData();
    if (refreshed.success && refreshed.data) setSnapshot(refreshed.data);
    toast.add({
      title: "List saved",
      description: `${parsed.length} option${parsed.length === 1 ? "" : "s"} are now live in every dropdown.`,
      type: "success",
    });
  }

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-lg">Master Data</CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              One value per line — these are the options every lead form and filter offers.
            </p>
          </div>
          <Badge
            className={
              snapshot.fromDatabase
                ? "border-green-200 bg-green-100 text-green-700 hover:bg-green-100"
                : "border-amber-200 bg-amber-100 text-amber-700 hover:bg-amber-100"
            }
          >
            {snapshot.fromDatabase ? "Live (database)" : "Seed preview (read-only)"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {!snapshot.fromDatabase && (
          <div className="rounded-md border border-dashed border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Editing is disabled until <span className="font-mono text-xs">supabase-master-data-migration.sql</span> is
            run in the Supabase SQL editor. Until then the app uses these seeded defaults.
          </div>
        )}

        <div className="grid gap-5 md:grid-cols-2">
          {MASTER_DATA_LISTS.map((key) => {
            const meta = LIST_META[key];
            const values = snapshot.lists[key] ?? [];
            return (
              <div key={key} className="space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <Label htmlFor={`master-${key}`}>{meta.title}</Label>
                  <span className="text-xs text-slate-500">{values.length} options</span>
                </div>
                <p className="text-xs text-slate-500">{meta.hint}</p>
                <Textarea
                  id={`master-${key}`}
                  rows={Math.min(Math.max(values.length, 4), 12)}
                  value={drafts[key] ?? ""}
                  readOnly={!snapshot.fromDatabase}
                  onChange={(event) =>
                    setDrafts((current) => ({ ...current, [key]: event.target.value }))
                  }
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={savingKey !== null || !snapshot.fromDatabase}
                  onClick={() => void handleSave(key)}
                >
                  {savingKey === key ? "Saving..." : "Save list"}
                </Button>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}