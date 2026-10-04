"use client";

// ---------------------------------------------------------------------------
// PipelineChart + Zoho-style tap: a segment opens the patient list for that
// exact (stage, treatment), and any row opens the shared detail drawer where
// the record can actually be EDITED (stage, treatment, follow-up, note, call).
// The old behaviour (navigate to a filtered list) stays one click away.
// ---------------------------------------------------------------------------

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Loader2, Users } from "lucide-react";

import { getLeadsPage, type Lead } from "@/app/actions/leads";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { LeadDetailDrawer } from "../lead-detail-drawer";
import { leadsHref, type LeadListFilters } from "../lead-filters";
import type { PipelineRow, TreatmentSeries } from "./analytics";
import { PipelineChart } from "./charts";

interface SegmentSelection {
  stageKey: string;
  stageLabel: string;
  treatmentKey: string;
  treatmentLabel: string;
  except: string;
  sampleIds: string[];
}

export function PipelineDetail({
  data,
  series,
  filters = {},
}: {
  data: PipelineRow[];
  series?: TreatmentSeries[];
  /** Current page filters so "View all in leads table" keeps the context. */
  filters?: Partial<LeadListFilters>;
}) {
  const [segment, setSegment] = useState<SegmentSelection | null>(null);
  const [patients, setPatients] = useState<Lead[]>([]);
  const [loadingPatients, setLoadingPatients] = useState(false);
  const [segmentTotal, setSegmentTotal] = useState(0);
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  async function loadSegment(selection: SegmentSelection) {
    setSegment(selection);
    setPatients([]);
    setSegmentTotal(0);
    setLoadingPatients(true);
    const response = await getLeadsPage(1, 50, "", "", "", {
      stage: selection.stageKey,
      treatment: selection.treatmentKey,
      except: selection.except,
      ...filters,
    });
    setLoadingPatients(false);
    if (response.success) {
      setPatients(response.data.leads);
      setSegmentTotal(response.data.total);
    }
  }

  function openPatient(leadId: string) {
    setOpenLeadId(leadId);
    setDrawerOpen(true);
  }

  const segmentHref = segment
    ? leadsHref({
        ...filters,
        stage: segment.stageKey,
        treatment: segment.treatmentKey,
        except: segment.except,
      })
    : "/dashboard/leads";

  return (
    <>
      <PipelineChart data={data} series={series} onSegmentClick={(detail) => void loadSegment(detail)} />

      <Dialog open={segment !== null} onOpenChange={(open) => (open ? undefined : setSegment(null))}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="size-4 text-slate-500" aria-hidden="true" />
              {segment ? `${segment.stageLabel} · ${segment.treatmentLabel}` : "Patients"}
            </DialogTitle>
            <DialogDescription>
              {loadingPatients
                ? "Loading patients in this segment…"
                : `${segmentTotal.toLocaleString()}  patients in this segment — click a name to view and edit it.`}
            </DialogDescription>
          </DialogHeader>

          {loadingPatients && (
            <p className="flex items-center gap-2 py-6 text-sm text-slate-500">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading…
            </p>
          )}

          {!loadingPatients && patients.length === 0 && (
            <p className="py-6 text-center text-sm text-slate-500">No patients in this segment.</p>
          )}

          {!loadingPatients && patients.length > 0 && (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {patients.map((patient) => (
                <li key={patient.id}>
                  <button
                    type="button"
                    onClick={() => openPatient(patient.id)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-slate-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-900">{patient.name}</span>
                      <span className="block text-xs text-slate-500">
                        {patient.phone} · {patient.city} · {patient.status}
                      </span>
                    </span>
                    <ArrowUpRight className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {!loadingPatients && segmentTotal > patients.length && (
            <p className="text-xs text-slate-500">Showing the first {patients.length}.</p>
          )}

          <div className="flex justify-end">
            <Link
              href={segmentHref}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              View all in leads table
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
        </DialogContent>
      </Dialog>

      <LeadDetailDrawer
        leadId={openLeadId}
        open={drawerOpen}
        title={segment ? `${segment.stageLabel} · ${segment.treatmentLabel}` : undefined}
        onOpenChange={setDrawerOpen}
        onMutated={(lead) => setPatients((current) => current.map((row) => (row.id === lead.id ? lead : row)))}
      />
    </>
  );
}
