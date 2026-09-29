// Aurevia CRM — Kanban pipeline board.
//
// SAME DATA AS THE LEADS PAGE, DIFFERENT SHAPE: every column is one pipeline
// stage (`stageForStatus` grouping, so the board and the charts can never
// disagree). A card can be moved by dragging it (desktop) or with the stage
// picker on the card (touch/keyboard, where HTML5 drag does not exist).
"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Loader2, Phone, UserRound } from "lucide-react";

import {
  getPipelineBoard,
  updateLeadStatus,
  type BoardColumn,
  type BoardLead,
  type PipelineBoardData,
  type ViewerRole,
} from "@/app/actions/leads";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";

import { EMPTY_LEAD_FILTERS, leadsHref, relativeLeadAge } from "../lead-filters";
import { LeadDetailDrawer } from "../lead-detail-drawer";

// Stage colours, so a column keeps the identity it has in the charts.
const COLUMN_ACCENTS: Record<string, string> = {
  new: "#64748b",
  contacted: "#0ea5e9",
  booked: "#6366f1",
  attended: "#f59e0b",
  surgery: "#10b981",
  lost: "#ef4444",
};

function temperatureTone(temperature: string): string {
  const value = (temperature ?? "").toLowerCase();
  if (value.includes("hot")) return "border-red-200 bg-red-50 text-red-700";
  if (value.includes("cold")) return "border-sky-200 bg-sky-50 text-sky-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

// One patient card: who it is, which treatment, how fresh, who owns it.
function BoardCard({
  lead,
  dragging,
  busy,
  onDragStart,
  onDragEnd,
  onOpen,
  onMove,
  stages,
}: {
  lead: BoardLead;
  dragging: boolean;
  busy: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpen: () => void;
  onMove: (status: string) => void;
  stages: { key: string; label: string; status: string }[];
}) {
  void stages;
  const targetStatus = stages.some((stage) => stage.status === lead.status) ? lead.status : "New";
  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", lead.id);
        event.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={`group cursor-grab rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-all hover:border-slate-300 hover:shadow-md ${
        dragging ? "opacity-50" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 text-left text-sm font-semibold text-slate-900 hover:text-blue-700"
        >
          <span className="line-clamp-2">{lead.name || "Unnamed lead"}</span>
        </button>
        {busy && <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-slate-400" aria-hidden="true" />}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span
          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700"
          title={lead.disease || "Treatment not recorded"}
        >
          Treatment recorded
        </span>
        <Badge variant="outline" className={`text-[11px] ${temperatureTone(lead.temperature)}`}>
          {lead.temperature || "Warm"}
        </Badge>
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
        {lead.city && lead.city !== "-" && <span>{lead.city}</span>}
        <span className="inline-flex items-center gap-1">
          <UserRound className="size-3" aria-hidden="true" />
          {lead.assigned_to && lead.assigned_to !== "-" ? lead.assigned_to : "Unassigned"}
        </span>
      </p>
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-500">
        <span>{relativeLeadAge(lead.created_at) ?? "Added: -"}</span>
        <span className={lead.follow_up_date && lead.follow_up_date !== "-" ? "font-medium text-amber-700" : ""}>
          {lead.follow_up_date && lead.follow_up_date !== "-" ? `Follow-up ${lead.follow_up_date}` : "No follow-up"}
        </span>
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        {lead.phone && lead.phone !== "-" && (
          <a
            href={`tel:${lead.phone}`}
            onClick={(event) => event.stopPropagation()}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
          >
            <Phone className="size-3" aria-hidden="true" />
            Call
          </a>
        )}
        {/* Touch + keyboard path: HTML5 drag does not exist on phones. */}
        <select
          value={targetStatus}
          onChange={(event) => onMove(event.target.value)}
          aria-label={`Move ${lead.name || "lead"} to another stage`}
          className="h-7 flex-1 rounded-md border border-slate-200 bg-white px-1.5 text-[11px] font-medium text-slate-600"
        >
          {stages.map((stage) => (
            <option key={stage.key} value={stage.status}>
              {stage.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}


// The board header strip: how many leads are on the board at a glance.
function BoardSummary({ total, columnCount, role }: { total: number; columnCount: number; role: ViewerRole }) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
      <span>
        <strong className="text-slate-900">{total.toLocaleString()}</strong> leads across {columnCount} stages
      </span>
      <span className="inline-flex items-center gap-1">
        <ArrowUpRight className="size-3" aria-hidden="true" />
        Drag a card, or use the stage picker on it — both save instantly.
      </span>
      {role === "employee" && <span>Showing only the leads assigned to you.</span>}
    </div>
  );
}

// One stage column: exact count, newest cards, and a "more in Leads" overflow.
function BoardColumnView({
  column,
  isDropTarget,
  cardLimit,
  stageTargets,
  draggingId,
  busyId,
  onDragOverColumn,
  onDragLeaveColumn,
  onDropColumn,
  onDragStartCard,
  onDragEndCard,
  onOpenCard,
  onMoveCard,
}: {
  column: BoardColumn;
  isDropTarget: boolean;
  cardLimit: number;
  stageTargets: { key: string; label: string; status: string }[];
  draggingId: string | null;
  busyId: string | null;
  onDragOverColumn: () => void;
  onDragLeaveColumn: () => void;
  onDropColumn: () => void;
  onDragStartCard: (id: string) => void;
  onDragEndCard: () => void;
  onOpenCard: (id: string) => void;
  onMoveCard: (lead: BoardLead, status: string) => void;
}) {
  const hidden = Math.max(column.total - column.leads.length, 0);
  void cardLimit;
  return (
    <section
      onDragOver={(event) => {
        event.preventDefault();
        onDragOverColumn();
      }}
      onDragLeave={onDragLeaveColumn}
      onDrop={(event) => {
        event.preventDefault();
        onDropColumn();
      }}
      aria-label={`${column.label} — ${column.total} leads`}
      className={`flex w-[19rem] shrink-0 flex-col rounded-xl border bg-slate-50/70 p-3 transition-colors ${
        isDropTarget ? "border-blue-400 bg-blue-50" : "border-slate-200"
      }`}
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <span
            className="size-2.5 rounded-full"
            style={{ backgroundColor: COLUMN_ACCENTS[column.key] ?? "#64748b" }}
            aria-hidden="true"
          />
          {column.label}
        </h2>
        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-700 shadow-sm">
          {column.total.toLocaleString()}
        </span>
      </header>
      <div className="mt-3 flex flex-1 flex-col gap-2">
        {column.leads.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-white/60 px-3 py-6 text-center text-xs text-slate-400">
            {isDropTarget ? "Drop here" : "No leads in this stage"}
          </p>
        ) : (
          column.leads.map((lead) => (
            <BoardCard
              key={lead.id}
              lead={lead}
              stages={stageTargets}
              dragging={draggingId === lead.id}
              busy={busyId === lead.id}
              onDragStart={() => onDragStartCard(lead.id)}
              onDragEnd={onDragEndCard}
              onOpen={() => onOpenCard(lead.id)}
              onMove={(status) => onMoveCard(lead, status)}
            />
          ))
        )}
        {hidden > 0 && (
          <Link
            href={leadsHref({ ...EMPTY_LEAD_FILTERS, stage: column.key })}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-center text-xs font-medium text-slate-600 transition-colors hover:border-slate-400 hover:bg-slate-50"
          >
            +{hidden.toLocaleString()} more in {column.label} — open in Leads
          </Link>
        )}
      </div>
    </section>
  );
}

// State + server round-trips for the whole board (kept last, above the hooks
// limits the two view components stay purely presentational).
export function PipelineBoard({ initialData, role }: { initialData: PipelineBoardData; role: ViewerRole }) {
  const [columns, setColumns] = useState<BoardColumn[]>(initialData.columns);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);

  const stageTargets = columns.map(({ key, label, status }) => ({ key, label, status }));

  // Re-reads the board from the server, so counts are never guessed.
  async function resync() {
    const response = await getPipelineBoard();
    if (!response.success) {
      toast.add({ title: "Could not refresh the board", description: response.error, type: "error" });
      return;
    }
    setColumns(response.data.columns);
  }

  // Moves one card into `target` (optimistically) and persists the new status.
  async function moveCard(lead: BoardLead, target: BoardColumn, fromKey: string) {
    const previousColumns = columns;
    setColumns((current) =>
      current.map((column) => {
        if (column.key === fromKey) {
          return {
            ...column,
            total: Math.max(column.total - 1, 0),
            leads: column.leads.filter((entry) => entry.id !== lead.id),
          };
        }
        if (column.key === target.key) {
          return {
            ...column,
            total: column.total + 1,
            leads: [{ ...lead, status: target.status }, ...column.leads].slice(0, initialData.cardLimit),
          };
        }
        return column;
      }),
    );

    setBusyId(lead.id);
    const response = await updateLeadStatus({ id: lead.id, status: target.status, temperature: lead.temperature });
    setBusyId(null);

    if (!response.success) {
      // The board must never disagree with the database.
      setColumns(previousColumns);
      toast.add({ title: "Move failed", description: response.error, type: "error" });
      await resync();
      return;
    }
    toast.add({
      title: `${lead.name || "Lead"} → ${target.label}`,
      description: `Status saved as "${target.status}".`,
      type: "success",
    });
  }

  function handleDrop(target: BoardColumn) {
    const leadId = draggingId;
    setDragOverKey(null);
    setDraggingId(null);
    if (!leadId) return;
    const source = columns.find((column) => column.leads.some((lead) => lead.id === leadId));
    if (!source || source.key === target.key) return;
    const lead = source.leads.find((entry) => entry.id === leadId);
    if (!lead) return;
    void moveCard(lead, target, source.key);
  }

  return (
    <div className="space-y-4">
      <BoardSummary total={initialData.total} columnCount={columns.length} role={role} />
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-3">
        {columns.map((column) => (
          <BoardColumnView
            key={column.key}
            column={column}
            isDropTarget={dragOverKey === column.key}
            cardLimit={initialData.cardLimit}
            stageTargets={stageTargets}
            draggingId={draggingId}
            busyId={busyId}
            onDragOverColumn={() => setDragOverKey(column.key)}
            onDragLeaveColumn={() => setDragOverKey((current) => (current === column.key ? null : current))}
            onDropColumn={() => handleDrop(column)}
            onDragStartCard={setDraggingId}
            onDragEndCard={() => {
              setDraggingId(null);
              setDragOverKey(null);
            }}
            onOpenCard={setOpenLeadId}
            onMoveCard={(lead, status) => {
              const target = columns.find((entry) => entry.status === status);
              if (target && target.key !== column.key) void moveCard(lead, target, column.key);
            }}
          />
        ))}
      </div>
      <LeadDetailDrawer
        leadId={openLeadId}
        open={openLeadId !== null}
        title="Pipeline board"
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setOpenLeadId(null);
            // A drawer edit can change the status/treatment, so re-read the board.
            void resync();
          }
        }}
      />
    </div>
  );
}

