"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CallingWorkspace } from "./calling-workspace";
import { voiceBotTreatment } from "@/lib/lead-treatment";
import { PhonePreview } from "./phone-preview";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { ArrowRightLeft, CalendarDays, ChevronLeft, ChevronRight, ClipboardPaste, Dices, Download, FileUp, Loader2, Pencil, Plus, RotateCcw, Search, SearchX, Trash2, UserRound, UserRoundPlus, Users, X } from "lucide-react";
import {
  findLeadImportHeaderRow,
  getRecognizedLeadImportFields,
  leadImportGridToRecords,
  normalizeLeadImportHeader,
} from "@/lib/lead-import";

import {
  addLeadActivity,
  bulkDeleteLeads,
  bulkInsertLeads,
  createLead,
  deleteLeadSourceBatches,
  getEmployees,
  getLeadActivities,
  getLeadDeletionBackupForExport,
  getLeadDeletionBackups,
  getUnassignedLeadAssignmentSuggestions,
  getLeadSourceBatches,
  getLeadsForSourceBatches,
  permanentlyDeleteLeadDeletionBackup,
  restoreLeadDeletionBackup,
  getLeadsForExport,
  getLeadsPage,
  updateLeadDetails,
  updateLeadStatus,
  updateLeadAssignment,
  updateLeadFollowUpDate,
  updateLeadAppointment,
  randomAssignLeads,
  assignLeadsToEmployees,
  addLeadsToAssignmentBatch,
  deleteLeadAssignmentBatch,
  getLeadAssignmentBatches,
  getLeadsForAssignmentBatch,
  getEmployeeLeadsForTransfer,
  getDuplicateLeadReviewQueue,
  getDuplicateReviewLeadsForExport,
  resolveDuplicateLeadReviews,
  transferLeadAssignmentBatch,
  type LeadAssignmentCriteria,
  type LeadAssignmentBatch,
  type LeadAssignmentSuggestion,
  type LeadSourceBatch,
  type Lead,
  type LeadActivity,
  type DuplicateLeadReviewItem,
  type Employee,
  type ViewerRole,
} from "@/app/actions/leads";
import {
  DELETE_ALL_CONFIRMATION,
  LEAD_DELETION_BACKUP_SETUP_HINT,
  type LeadDeletionBackup,
} from "@/lib/lead-deletion";
import {
  appointmentForStatus,
  isWonStatus,
  normaliseAppointmentDate,
} from "@/lib/appointments";
import { seedMasterData, type MasterDataSnapshot } from "@/lib/master-data";
import { LEAD_STATUS_OPTIONS, canonicalLeadStatus } from "@/lib/lead-status";
import { getMasterData } from "@/app/actions/master-data";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { AppointmentDatePicker } from "./calendar/appointment-date-picker";
import { celebrateLeadWin } from "./celebrate";
import { DAILY_WORK_LABELS } from "@/lib/daily-work";

async function downloadLeadsExcel(leads: Lead[], fileName: string): Promise<void> {
  const excel = await import("@/lib/lead-excel");
  excel.downloadLeadsExcel(leads, fileName);
}
import {
  AGE_CHIP_BUCKETS,
  EMPTY_LEAD_FILTERS,
  ageBucketLabel,
  filterChipLabels,
  hasLeadFilters,
  isNewLead,
  leadsHref,
  monthFilterLabel,
  prettifyFilterKey,
  relativeLeadAge,
  stageFilterKeys,
  type LeadListFilters,
} from "./lead-filters";
import { trackLeadMutations } from "./lead-mutation-tracker";
import { canonicalTreatment, resolveTreatmentText, stageForStatus, treatmentColor } from "./overview/analytics";

interface ImportRow {
  "Full Name"?: string;
  Name?: string;
  name?: string;
  "Contact no"?: string;
  Phone?: string;
  phone?: string;
  Email?: string;
  email?: string;
  Gender?: string;
  City?: string;
  Disease?: string;
  "Insurance Status"?: string;
  "Lead Status"?: string;
  "Remark 1"?: string;
  "Lead Date"?: string;
  "Assigned To"?: string;
  Source?: string;
  source?: string;
}

// Dropdown options (status / source) live in the DATABASE so an
// admin can edit them in Settings → Master Data without a deploy
// (supabase-master-data-migration.sql). `seedMasterData()` is the fallback: the
// selects render real options immediately, before the fetch resolves.

// Must match LEADS_PAGE_SIZE in app/actions/leads.ts ("use server" files can
// only export async functions, so the constant is duplicated here).
const LEADS_PAGE_SIZE = 50;

// "Magic Paste" accepts the same delimited formats as CSV import. The shared
// parser finds a likely header row and all remaining columns use the same
// flexible server-side mapping as uploaded spreadsheets.
function parsePastedTable(text: string): ImportRow[] {
  const result = Papa.parse<unknown[]>(text, { skipEmptyLines: "greedy" });
  return leadImportGridToRecords(result.data).map((record) => record as ImportRow);
}

// Reads the detected header row from pasted delimited data.
function getPastedHeaders(text: string): string[] {
  const rows = Papa.parse<unknown[]>(text, { skipEmptyLines: "greedy" }).data;
  const headerRow = findLeadImportHeaderRow(rows);
  return headerRow < 0
    ? []
    : rows[headerRow].map((cell) => String(cell ?? "").trim()).filter(Boolean);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function getInitials(name: string): string {
  return name.split(" ").filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

type TransferDisposition = "keep" | "fresh";

function TransferDispositionChoices({
  value,
  onChange,
  disabled = false,
  idPrefix,
}: {
  value: TransferDisposition;
  onChange: (value: TransferDisposition) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium text-slate-800">How should the new agent receive these leads?</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        <label htmlFor={`${idPrefix}-keep`} className={`flex cursor-pointer gap-2 rounded-lg border p-3 text-sm ${value === "keep" ? "border-emerald-400 bg-emerald-50" : "border-slate-200 bg-white"}`}>
          <input id={`${idPrefix}-keep`} type="radio" name={`${idPrefix}-disposition`} checked={value === "keep"} onChange={() => onChange("keep")} className="mt-0.5 accent-emerald-700" />
          <span><span className="block font-semibold text-slate-900">Keep current status</span><span className="mt-0.5 block text-xs text-slate-600">The lead keeps its current disposition.</span></span>
        </label>
        <label htmlFor={`${idPrefix}-fresh`} className={`flex cursor-pointer gap-2 rounded-lg border p-3 text-sm ${value === "fresh" ? "border-emerald-400 bg-emerald-50" : "border-slate-200 bg-white"}`}>
          <input id={`${idPrefix}-fresh`} type="radio" name={`${idPrefix}-disposition`} checked={value === "fresh"} onChange={() => onChange("fresh")} className="mt-0.5 accent-emerald-700" />
          <span><span className="block font-semibold text-slate-900">Send as a Fresh Lead</span><span className="mt-0.5 block text-xs text-slate-600">Status becomes New; previous history stays visible.</span></span>
        </label>
      </div>
      <p className="text-xs text-slate-500">Notes, calls, and appointment history are retained. The follow-up date is cleared; the receiving agent sees a Previous history marker.</p>
    </fieldset>
  );
}

// Common lead sources offered by the editable Source field. The lead's current
// value is always merged in, so custom sources stay selectable.

function sourceBadgeClass(source: string): string {
  if (source.toLowerCase().includes("meta")) return "border-blue-200 bg-blue-50 text-blue-700";
  if (source.toLowerCase().includes("excel") || source.toLowerCase().includes("csv")) return "border-green-200 bg-green-50 text-green-700";
  return "border-slate-200 bg-slate-100 text-slate-600";
}

// DD/MM/YYYY -> YYYY-MM-DD so dates compare chronologically instead of alphabetically.
type DateFilterField = "lead_date" | "follow_up_date";

function buildDateFilter(dateField: DateFilterField, from: string, to: string) {
  const fromIso = from ? `${from}T00:00:00.000Z` : "";
  const toIso = to ? `${to}T23:59:59.999Z` : "";
  if (!fromIso && !toIso) return null;
  return {
    dateField,
    fromIso,
    toIso,
  };
}

// Normalizes BOTH stored formats — DD/MM/YYYY (Excel imports, Meta webhook) and
// YYYY-MM-DD (native date pickers) — into one sortable ISO string. Unknown or
// empty values return "" so they group together instead of crashing comparisons.
function parseLeadDateForSort(value: string): string {
  const isoMatch = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const dmyMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!dmyMatch) return "";
  const [, day, month, year] = dmyMatch;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

// Value for <input type="date"> elements: always YYYY-MM-DD, "" when unset.
function toInputDateValue(value: string): string {
  return value && value !== "-" ? parseLeadDateForSort(value) : "";
}

// Always displays DD/MM/YYYY in the table, regardless of the stored format.
// Unparseable values fall back to the raw string — never crashes.
function formatLeadDateDisplay(value: string): string {
  if (!value || value === "-") return "N/A";
  const iso = parseLeadDateForSort(value);
  if (!iso) return value;
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

/**
 * The treatment the charts would file this lead under: every plausible column is
 * probed (treatment_type → treatment → disease → …) with a `remarks` fallback,
 * then collapsed to the canonical key + label. `detail` carries the raw disease
 * text so the row still shows exactly what was typed.
 */
function treatmentCellData(lead: Lead): { key: string; label: string; detail: string; hasSummary: boolean } {
  const resolved = resolveTreatmentText(lead as unknown as Record<string, unknown>) || lead.disease || "";
  const raw = (lead.disease ?? "").trim();
  const summaryTreatment = voiceBotTreatment(raw);
  const treatmentText = summaryTreatment ?? resolved;
  const { key, label } = canonicalTreatment(treatmentText);
  const description = summaryTreatment ?? raw;
  const detail = description && description !== "-" && description.toLowerCase() !== label.toLowerCase() ? description : "";
  return { key, label, detail, hasSummary: summaryTreatment !== null || raw.length > 100 };
}

function compareLeads(a: Lead, b: Lead, key: string): number {
  if (key === "lead_date") {
    return parseLeadDateForSort(a.lead_date).localeCompare(parseLeadDateForSort(b.lead_date));
  }
  if (key === "assigned_to") {
    return (a.assigned_to ?? "").localeCompare(b.assigned_to ?? "");
  }
  if (key === "status") {
    return a.status.localeCompare(b.status);
  }
  return a.name.localeCompare(b.name);
}

function SortableTableHead({
  label,
  sortKey,
  sortConfig,
  onSort,
  className,
}: {
  label: string;
  sortKey: string;
  sortConfig: { key: string; direction: "asc" | "desc" } | null;
  onSort: (key: string) => void;
  className?: string;
}) {
  const isActive = sortConfig?.key === sortKey;
  const direction = isActive ? sortConfig.direction : null;
  return (
    <TableHead className={className} aria-sort={isActive ? (direction === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 rounded text-left font-semibold text-slate-600 transition-colors hover:text-slate-900"
      >
        {label}
        <span className="text-xs" aria-hidden="true">{direction === "asc" ? "↑" : direction === "desc" ? "↓" : "↕"}</span>
      </button>
    </TableHead>
  );
}

/**
 * One removable chip per active chart drill-down (?stage=, ?treatment=, ...).
 * `next` is the filter state left after removing this chip, so a single click
 * rewrites the URL without losing the other filters.
 */
function drillDownChips(filters: LeadListFilters): {
  key: string;
  label: string;
  next: Partial<LeadListFilters>;
}[] {
  const labels = filterChipLabels();
  const chips: { key: string; label: string; next: Partial<LeadListFilters> }[] = [];

  const stageKeys = stageFilterKeys(filters.stage);
  if (filters.work) chips.push({ key: "work", label: `${DAILY_WORK_LABELS[filters.work]} · ${filters.day}`, next: { work: "", day: "" } });
  for (const key of stageKeys) {
    chips.push({
      key: `stage-${key}`,
      label: labels[key] ?? prettifyFilterKey(key),
      next: { stage: stageKeys.filter((candidate) => candidate !== key).join(",") },
    });
  }
  if (filters.treatment) {
    chips.push({
      key: "treatment",
      label: labels[filters.treatment] ?? prettifyFilterKey(filters.treatment),
      next: { treatment: "", except: "" },
    });
  }
  if (filters.age) chips.push({ key: "age", label: ageBucketLabel(filters.age), next: { age: "" } });
  if (filters.month) {
    chips.push({ key: "month", label: monthFilterLabel(filters.month), next: { month: "" } });
  }
  if (filters.city) chips.push({ key: "city", label: filters.city, next: { city: "" } });
  if (filters.source) chips.push({ key: "source", label: filters.source, next: { source: "" } });
  if (filters.assigned) chips.push({ key: "assigned", label: filters.assigned, next: { assigned: "" } });
  if (filters.assignmentStatus) {
    chips.push({
      key: "assignmentStatus",
      label: filters.assignmentStatus === "unassigned" ? "Unassigned leads" : "Assigned leads",
      next: { assignmentStatus: "" },
    });
  }
  if (filters.assignmentBatchId) {
    chips.push({ key: "assignmentBatchId", label: `Assignment batch · ${filters.assignmentBatchId.slice(0, 8)}`, next: { assignmentBatchId: "" } });
  }
  if (filters.status) chips.push({ key: "status", label: filters.status, next: { status: "" } });
  if (filters.q) chips.push({ key: "q", label: `Search: "${filters.q}"`, next: { q: "" } });
  return chips;
}

// The ONE place that turns lead rows into a downloaded CSV file. Used by the
// toolbar export AND by the pre-delete safety copy below, so both always write
// the same 15 columns (a backup that cannot be re-imported is not a backup).
function downloadLeadsCsv(leads: Lead[], fileName: string) {
  const rows = leads.map((lead) => ({
    Name: lead.name,
    Phone: lead.phone,
    Email: lead.email,
    Gender: lead.gender,
    City: lead.city,
    Treatment: lead.disease,
    "Insurance Status": lead.insurance_status,
    Remarks: lead.remarks,
    "Lead Date": lead.lead_date,
    "Follow-Up Date": lead.follow_up_date,
    Source: lead.source,
    Status: lead.status,
    "Assigned To": lead.assigned_to,
    "Created At": lead.created_at,
  }));
  const csv = Papa.unparse(rows);
  // BOM so Excel opens the file with correct encoding.
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function sourceBatchKey(batch: Pick<LeadSourceBatch, "id" | "source">): string {
  return batch.id ? `batch:${batch.id}` : `legacy:${batch.source}`;
}

export function LeadsTable({
  leads: initialLeads,
  initialTotal,
  initialTotalPages,
  assignedTo = "",
  role = "employee",
  filters = EMPTY_LEAD_FILTERS,
  initialOpenLeadId = "",
}: {
  leads: Lead[];
  initialTotal: number;
  initialTotalPages: number;
  // When set (admin drill-down), all fetching and bulk actions are scoped to
  // this employee's leads only (server-side assigned_to filter).
  assignedTo?: string;
  // Employees can edit patient details on their assigned leads. Team-lead-only
  // controls remain assignment, source, import, deletion and team visibility.
  role?: ViewerRole;
  // Chart drill-down filters from the URL (?stage=&treatment=&age=&city=).
  // They travel with EVERY server call so paging/export stays filtered.
  filters?: LeadListFilters;
  initialOpenLeadId?: string;
}) {
  const router = useRouter();
  // Role gates (plain booleans — zero runtime cost, standard conditional rendering).
  const isAdmin = role === "admin";
  const isManager = role === "manager";
  const canBulkUpload = isAdmin || isManager;
  const canDelete = isAdmin || isManager;
  const canSeeSource = isAdmin || isManager;
  const canEditCore = isAdmin || isManager;
  const [leads, setLeads] = useState(initialLeads);
  // Server-side pagination state: only one page of 50 leads lives in memory;
  // the next page is fetched from the server on demand.
  const [page, setPage] = useState(1);
  const [serverTotal, setServerTotal] = useState(initialTotal);
  const [serverTotalPages, setServerTotalPages] = useState(initialTotalPages);
  const [isPaging, setIsPaging] = useState(false);
  // True while the header "select all" checkbox is checked — bulk delete then
  // sends a { deleteAll: true } flag instead of thousands of IDs.
  const [isSelectAllChecked, setIsSelectAllChecked] = useState(false);
  // A wipe-everything delete now needs the phrase typed out, and every bulk
  // delete leaves a snapshot in `lead_deletion_backups` (restore panel below).
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [isRestoreOpen, setIsRestoreOpen] = useState(false);
  const [deletionBackups, setDeletionBackups] = useState<LeadDeletionBackup[]>([]);
  const [isLoadingBackups, setIsLoadingBackups] = useState(false);
  const [backupErrorText, setBackupErrorText] = useState("");
  const [restoringBackupId, setRestoringBackupId] = useState<string | null>(null);
  const [downloadingBackupId, setDownloadingBackupId] = useState<string | null>(null);
  const [backupPendingDeletion, setBackupPendingDeletion] = useState<LeadDeletionBackup | null>(null);
  const [deletingBackupId, setDeletingBackupId] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isAddLeadOpen, setIsAddLeadOpen] = useState(false);
  const [isCreatingLead, setIsCreatingLead] = useState(false);
  const [savingLeadIds, setSavingLeadIds] = useState<Set<string>>(() => new Set());
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const autoOpenedLeadIdRef = useRef<string | null>(null);
  const [leadEdits, setLeadEdits] = useState({ city: "", disease: "", insurance_status: "", remarks: "" });
  const [isSavingEdits, setIsSavingEdits] = useState(false);
  // "Edit Lead" modal: patient details are editable for every owner; source
  // and assignment are restricted to admins/managers.
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [editTransferAsFresh, setEditTransferAsFresh] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "",
    phone: "",
    email: "",
    gender: "",
    city: "",
    disease: "",
    insurance_status: "",
    remarks: "",
    assigned_to: "",
    status: "",
    lead_date: "",
    follow_up_date: "",
    source: "",
  });
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  // "Magic Paste" modal: paste tabular data straight from Excel/Google Sheets.
  const [isPasteOpen, setIsPasteOpen] = useState(false);
  const [pastedData, setPastedData] = useState("");
  // Live Magic Paste preview: data row count (header row excluded) plus which
  // canonical columns were recognized in the pasted header row.
  const pastePreview = useMemo(() => {
    if (!isPasteOpen) return { rowCount: 0, recognized: [] as string[], hasAnyHeader: false };
    const rowCount = parsePastedTable(pastedData).length;
    const headers = getPastedHeaders(pastedData);
    const normalizedHeaders = headers.map(normalizeLeadImportHeader);
    const recognized = getRecognizedLeadImportFields(headers);
    return { rowCount, recognized, hasAnyHeader: normalizedHeaders.length > 0 };
  }, [isPasteOpen, pastedData]);
  const [activities, setActivities] = useState<LeadActivity[]>([]);
  const [isLoadingActivities, setIsLoadingActivities] = useState(false);
  const [note, setNote] = useState("");
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const assignableEmployees = employees.filter(
    (employee) =>
      employee.name.trim() !== "" &&
      employee.name !== "-" &&
      employee.name !== "Unassigned" &&
      (isAdmin || employee.role === "employee"),
  );
  // Master data (Settings → Master Data): the DB-backed picklists. Seeded first
  // so the selects are never empty, then upgraded with the admin's lists.
  const [masterData, setMasterData] = useState<MasterDataSnapshot>(() => seedMasterData());
  const [quickNoteLead, setQuickNoteLead] = useState<Lead | null>(null);
  const [quickNote, setQuickNote] = useState("");
  const [isSavingQuickNote, setIsSavingQuickNote] = useState(false);
  const [selectedLeads, setSelectedLeads] = useState<string[]>([]);
  const [isBulkActionPending, setIsBulkActionPending] = useState(false);
  const [duplicateReviewItems, setDuplicateReviewItems] = useState<DuplicateLeadReviewItem[]>([]);
  const [isDuplicateReviewOpen, setIsDuplicateReviewOpen] = useState(false);
  const [isLoadingDuplicateReviews, setIsLoadingDuplicateReviews] = useState(false);
  const [isResolvingDuplicateReviews, setIsResolvingDuplicateReviews] = useState(false);
  const [duplicateReviewError, setDuplicateReviewError] = useState("");
  const [selectedDuplicateReviewIds, setSelectedDuplicateReviewIds] = useState<string[]>([]);
  const [duplicateReviewTarget, setDuplicateReviewTarget] = useState("");
  const [duplicateReviewAsFresh, setDuplicateReviewAsFresh] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isAssignmentOpen, setIsAssignmentOpen] = useState(false);
  const [assignmentMode, setAssignmentMode] = useState<"selected" | "transfer-selected" | "filters" | "add-to-batch">("filters");
  const [assignmentBatchTarget, setAssignmentBatchTarget] = useState<LeadAssignmentBatch | null>(null);
  const [assignmentEmployeeNames, setAssignmentEmployeeNames] = useState<string[]>([]);
  const [assignmentCriteria, setAssignmentCriteria] = useState<LeadAssignmentCriteria>({
    search: "",
    treatment: "",
    city: "",
    status: "",
  });
  const [assignmentSuggestions, setAssignmentSuggestions] = useState<LeadAssignmentSuggestion[]>([]);
  const [transferLeadIds, setTransferLeadIds] = useState<string[]>([]);
  const [transferSourceEmployee, setTransferSourceEmployee] = useState("");
  const [transferLeads, setTransferLeads] = useState<LeadAssignmentSuggestion[]>([]);
  const [transferLeadTotal, setTransferLeadTotal] = useState(0);
  const [transferLeadPage, setTransferLeadPage] = useState(0);
  const [isLoadingTransferLeads, setIsLoadingTransferLeads] = useState(false);
  const [isSelectingAllTransferLeads, setIsSelectingAllTransferLeads] = useState(false);
  const [transferLeadError, setTransferLeadError] = useState("");
  const [transferDisposition, setTransferDisposition] = useState<TransferDisposition>("keep");
  const [pendingLeadTransfer, setPendingLeadTransfer] = useState<{ lead: Lead; employeeName: string } | null>(null);
  const [selectedAssignmentLeads, setSelectedAssignmentLeads] = useState<LeadAssignmentSuggestion[]>([]);
  const [selectAllAssignmentMatches, setSelectAllAssignmentMatches] = useState(false);
  const [assignmentSuggestionTotal, setAssignmentSuggestionTotal] = useState(0);
  const [hasMoreAssignmentSuggestions, setHasMoreAssignmentSuggestions] = useState(false);
  const [isLoadingAssignmentSuggestions, setIsLoadingAssignmentSuggestions] = useState(false);
  const [assignmentSuggestionError, setAssignmentSuggestionError] = useState("");
  const [isSourceDeleteOpen, setIsSourceDeleteOpen] = useState(false);
  const [sourceBatches, setSourceBatches] = useState<LeadSourceBatch[]>([]);
  const [selectedSourceBatchKeys, setSelectedSourceBatchKeys] = useState<string[]>([]);
  const [isLoadingSourceBatches, setIsLoadingSourceBatches] = useState(false);
  const [sourceBatchLoadError, setSourceBatchLoadError] = useState("");
  const [isDeletingSource, setIsDeletingSource] = useState(false);
  const [isAssignmentBatchesOpen, setIsAssignmentBatchesOpen] = useState(false);
  const [assignmentBatches, setAssignmentBatches] = useState<LeadAssignmentBatch[]>([]);
  const [isLoadingAssignmentBatches, setIsLoadingAssignmentBatches] = useState(false);
  const [assignmentBatchError, setAssignmentBatchError] = useState("");
  const [assignmentBatchTargets, setAssignmentBatchTargets] = useState<Record<string, string>>({});
  const [assignmentBatchAction, setAssignmentBatchAction] = useState<{ batch: LeadAssignmentBatch; kind: "delete" | "transfer" } | null>(null);
  const [isAssignmentBatchActionPending, setIsAssignmentBatchActionPending] = useState(false);
  const [selectedSource, setSelectedSource] = useState("all");
  // Search/status seeded from the URL drill-down so paging and debounced typing
  // never drop the filter the admin arrived with.
  const [searchTerm, setSearchTerm] = useState(filters.q);
  // The search term currently applied on the SERVER. Search runs in Supabase
  // (.or / .ilike across ALL leads in the database), not against the 50 rows
  // loaded on the current page.
  const [activeSearch, setActiveSearch] = useState(filters.q);
  // Advanced status filter (server-side): "" = all.
  const [selectedStatus, setSelectedStatus] = useState(() =>
    filters.status && LEAD_STATUS_OPTIONS.some((status) => status === filters.status)
      ? filters.status
      : "all",
  );
  const [activeStatusFilter, setActiveStatusFilter] = useState(filters.status);
  const [isExporting, setIsExporting] = useState(false);
  const [dateField, setDateField] = useState<DateFilterField>("lead_date");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [isDatePopoverOpen, setIsDatePopoverOpen] = useState(false);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const successSummaryRef = useRef({ added: 0, assigned: 0, updated: 0, notes: 0, details: [] as string[], timer: null as ReturnType<typeof setTimeout> | null });
  // Guards against out-of-order responses when searches/pages change quickly —
  // only the most recently issued fetch is allowed to update the table.
  const fetchSequenceRef = useRef(0);
  const assignmentSuggestionSequenceRef = useRef(0);
  const transferLeadSequenceRef = useRef(0);

  function queueSuccessSummary(kind: "added" | "assigned" | "updated" | "notes", count = 1, detail?: string) {
    const summary = successSummaryRef.current;
    summary[kind] += count;
    if (detail) summary.details.push(detail);
    if (summary.timer) return;
    summary.timer = setTimeout(() => {
      const completed = { ...successSummaryRef.current };
      successSummaryRef.current = { added: 0, assigned: 0, updated: 0, notes: 0, details: [], timer: null };
      const parts = [
        completed.added ? `${completed.added} lead${completed.added === 1 ? "" : "s"} added` : "",
        completed.assigned ? `${completed.assigned} lead${completed.assigned === 1 ? "" : "s"} assigned` : "",
        completed.updated ? `${completed.updated} lead${completed.updated === 1 ? "" : "s"} updated` : "",
        completed.notes ? `${completed.notes} note${completed.notes === 1 ? "" : "s"} added` : "",
      ].filter(Boolean);
      if (parts.length) toast.add({ title: "CRM update complete", description: [parts.join(" · "), ...completed.details].join(" — "), type: "success" });
    }, 650);
  }

  useEffect(() => () => {
    if (successSummaryRef.current.timer) clearTimeout(successSummaryRef.current.timer);
  }, []);

  function setLeadSaving(id: string, saving: boolean) {
    setSavingLeadIds((current) => {
      const next = new Set(current);
      if (saving) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function updateLeadLocally(lead: Lead) {
    setLeads((current) => current.map((item) => (item.id === lead.id ? lead : item)));
    setSelectedLead((current) => (current?.id === lead.id ? lead : current));
  }

  function patchLeadLocally(id: string, patch: Partial<Lead>) {
    setLeads((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
    setSelectedLead((current) =>
      current?.id === id ? { ...current, ...patch } : current,
    );
  }

  const sourceOptions = Array.from(new Set(leads.map((lead) => lead.source)));
  // Admin-editable picklists (master data) with the loaded page merged in, so a
  // filter/edit still offers whatever values leads actually carry.
  const statuses = LEAD_STATUS_OPTIONS;
  const masterSourceOptions = Array.from(
    new Set([...masterData.lists.sources, ...sourceOptions]),
  );
  // "The database has nothing to show" — as opposed to "your filters hide it".
  // Drives the empty state so an empty pipeline never reads as a broken page.
  const isPipelineEmpty =
    serverTotal === 0 &&
    !assignedTo.trim() &&
    !activeSearch.trim() &&
    !activeStatusFilter.trim() &&
    !hasLeadFilters(filters);
  // Memoized so its identity is stable per filter change (used as a dependency
  // of the filtered/sorted pipelines below — avoids re-filtering on unrelated
  // re-renders like search-input keystrokes).
  const dateFilter = useMemo(
    () => buildDateFilter(dateField, dateFrom, dateTo),
    [dateField, dateFrom, dateTo],
  );
  const hasActiveFilters =
    activeSearch.length > 0 ||
    activeStatusFilter.length > 0 ||
    selectedSource !== "all" ||
    dateFilter !== null;

  function resetFilters() {
    setSearchTerm("");
    setSelectedStatus("all");
    setSelectedSource("all");
    setDateField("lead_date");
    setDateFrom("");
    setDateTo("");
    // Search/status hit the server, so clearing them must refetch page 1.
    if (activeSearch || activeStatusFilter) {
      setActiveSearch("");
      setActiveStatusFilter("");
      void fetchPage(1, "", "");
    }
  }

  // Chained layers: search (server-side) -> source -> date range (Lead Date or Follow-up Date) -> sorting.
  // Memoized: filtering only reruns when the page data or one of the filters
  // actually changes (not on every keystroke-driven re-render).
  const filteredLeads = useMemo(() => leads.filter((lead) => {
    // NOTE: search is applied SERVER-SIDE via activeSearch, so it matches leads
    // on every page of the database. Only these remaining filters run on the
    // rows currently loaded in the table.
    if (selectedSource !== "all" && lead.source !== selectedSource) return false;

    if (dateFilter) {
      const rawDate = dateFilter.dateField === "follow_up_date" ? lead.follow_up_date : lead.lead_date;
      if (!rawDate || rawDate === "-") return false;
      const timestamp = new Date(parseLeadDateForSort(rawDate).replace("T", " ") || rawDate).getTime();
      // Fallback: YYYY-MM-DD ya DD/MM/YYYY parse karne ki koshish, warna reject.
      let ts = timestamp;
      if (Number.isNaN(ts)) {
        const dmy = rawDate.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
        if (dmy) {
          ts = new Date(`${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}T00:00:00`).getTime();
        } else {
          ts = new Date(rawDate).getTime();
        }
      }
      if (Number.isNaN(ts)) return false;
      if (dateFilter.fromIso && ts < new Date(dateFilter.fromIso).getTime()) return false;
      if (dateFilter.toIso && ts > new Date(dateFilter.toIso).getTime()) return false;
    }

    return true;
  }), [leads, selectedSource, dateFilter]);

  const activeFilterChips: { key: string; label: string; onRemove: () => void }[] = [];
  if (activeSearch) {
    activeFilterChips.push({
      key: "search",
      label: `Search: "${activeSearch}"`,
      onRemove: () => {
        setSearchTerm("");
        setActiveSearch("");
        void fetchPage(1, "", activeStatusFilter);
      },
    });
  }
  if (activeStatusFilter) {
    activeFilterChips.push({
      key: "status",
      label: `Status: ${activeStatusFilter}`,
      onRemove: () => {
        setSelectedStatus("all");
        setActiveStatusFilter("");
        void fetchPage(1, activeSearch, "");
      },
    });
  }
  if (selectedSource !== "all") {
    activeFilterChips.push({ key: "source", label: `Source: ${selectedSource}`, onRemove: () => setSelectedSource("all") });
  }
  if (dateFilter) {
    activeFilterChips.push({
      key: "date",
      label: `${dateFilter.dateField === "follow_up_date" ? "Follow-Up" : "Lead"} Date: ${dateFrom || "..."} → ${dateTo || "..."}`,
      onRemove: () => {
        setDateFrom("");
        setDateTo("");
      },
    });
  }

  // Layer 3: Clickable column sorting (memoized — sorting only reruns when the
  // filtered set or the sort config changes).
  const sortedLeads = useMemo(() => sortConfig
    ? [...filteredLeads].sort((a, b) => {
        const result = compareLeads(a, b, sortConfig.key);
        return sortConfig.direction === "asc" ? result : -result;
      })
    : filteredLeads, [filteredLeads, sortConfig]);

  function toggleSort(key: string) {
    setSortConfig((current) =>
      current?.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" },
    );
  }

  // Fetches a page of leads from the server and swaps it into the table.
  // `search` is the server-side search term and `status` the server-side
  // status filter ("" = no filter).
  async function fetchPage(nextPage: number, search: string = activeSearch, status: string = activeStatusFilter) {
    const requestId = ++fetchSequenceRef.current;
    setIsPaging(true);
    const response = await getLeadsPage(nextPage, LEADS_PAGE_SIZE, search, assignedTo, status, filters);
    // Skip stale responses if the user kept typing or paging meanwhile.
    if (requestId !== fetchSequenceRef.current) return;
    if (!response.success) {
      toast.add({ title: "Unable to load leads", description: response.error, type: "error" });
    } else {
      setLeads(response.data.leads);
      setPage(response.data.page);
      setServerTotal(response.data.total);
      setServerTotalPages(response.data.totalPages);
      // Selections and sorting only apply to the currently loaded page.
      setSelectedLeads([]);
      setIsSelectAllChecked(false);
      setSortConfig(null);
    }
    setIsPaging(false);
  }

  const liveReload=useRef<()=>void>(()=>{});
  liveReload.current=()=>{void fetchPage(page);};
  useEffect(()=>{const reload=()=>liveReload.current();window.addEventListener("crm:leads-changed",reload);return()=>window.removeEventListener("crm:leads-changed",reload);},[]);

  async function handlePageChange(nextPage: number) {
    if (isPaging || nextPage < 1 || nextPage > serverTotalPages || nextPage === page) return;
    await fetchPage(nextPage);
  }

  // Debounced server-side search: after typing pauses, page 1 is refetched
  // with an .or()/ilike() query in Supabase matching ALL leads in the
  // database — not just the rows currently loaded in the table.
  useEffect(() => {
    const term = searchTerm.trim();
    if (term === activeSearch) return;
    const timer = setTimeout(() => {
      setActiveSearch(term);
      void fetchPage(1, term, activeStatusFilter);
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchPage is stable within a render cycle; activeSearch/activeStatusFilter are the applied-value guards
  }, [searchTerm, activeSearch, activeStatusFilter]);

  // Advanced status filter (server-side .eq chaining in Supabase).
  function handleStatusFilterSelect(value: string) {
    const next = value === "all" ? "" : value;
    setSelectedStatus(next || "all");
    setActiveStatusFilter(next);
    void fetchPage(1, activeSearch, next);
  }

  // Admin-only CSV export of all leads matching the current server filters.
  async function handleExportCsv() {
    setIsExporting(true);
    const response = await getLeadsForExport(activeSearch, activeStatusFilter, assignedTo, filters);
    if (!response.success) {
      toast.add({ title: "Export failed", description: response.error, type: "error" });
    } else {
      downloadLeadsCsv(response.data, `leads-export-${new Date().toISOString().slice(0, 10)}.csv`);
      toast.add({
        title: "Export ready",
        description: `${response.data.length} leads downloaded as CSV.`,
        type: "success",
      });
    }
    setIsExporting(false);
  }

  useEffect(() => {
    void getEmployees().then((result) => {
      if (result.success) setEmployees(result.data);
    });
    void getMasterData().then((result) => {
      if (result.success && result.data) setMasterData(result.data);
    });
  }, []);

  const refreshDuplicateReviews = useCallback(async (openDialog = false) => {
    if (!canDelete) return;
    setIsLoadingDuplicateReviews(true);
    setDuplicateReviewError("");
    try {
      const result = await getDuplicateLeadReviewQueue();
      if (!result.success) {
        setDuplicateReviewError(result.error);
        return;
      }
      setDuplicateReviewItems(result.data);
      setSelectedDuplicateReviewIds((current) => current.filter((id) => result.data.some((item) => item.id === id)));
      if (openDialog) setIsDuplicateReviewOpen(true);
    } catch {
      setDuplicateReviewError("Duplicate reviews could not be loaded. Please retry.");
    } finally {
      setIsLoadingDuplicateReviews(false);
    }
  }, [canDelete]);

  async function openDuplicateReviews() {
    setIsDuplicateReviewOpen(true);
    await refreshDuplicateReviews();
  }

  async function resolveSelectedDuplicateReviews(action: "assign" | "keep" | "delete") {
    if (selectedDuplicateReviewIds.length === 0 || isResolvingDuplicateReviews) return;
    if (action === "assign" && !duplicateReviewTarget) {
      setDuplicateReviewError("Choose an employee before assigning these leads.");
      return;
    }
    setIsResolvingDuplicateReviews(true);
    setDuplicateReviewError("");
    try {
      if (action === "delete") {
        const exportResult = await getDuplicateReviewLeadsForExport(selectedDuplicateReviewIds);
        if (!exportResult.success) {
          setDuplicateReviewError(`${exportResult.error} Nothing was deleted.`);
          return;
        }
        await downloadLeadsExcel(exportResult.data, `duplicate-leads-backup-before-delete-${new Date().toISOString().slice(0, 10)}.xlsx`);
      }
      const result = await resolveDuplicateLeadReviews({
        reviewIds: selectedDuplicateReviewIds,
        action,
        targetName: action === "assign" ? duplicateReviewTarget : undefined,
        asFresh: action === "assign" && duplicateReviewAsFresh,
      });
      if (!result.success) {
        setDuplicateReviewError(result.error);
        return;
      }
      const noun = result.data.affected === 1 ? "lead" : "leads";
      toast.add({
        title: action === "delete" ? "Duplicate leads deleted" : action === "keep" ? "Reviews completed" : "Duplicate leads assigned",
        description: action === "delete"
          ? `${result.data.affected} ${noun} deleted. An Excel copy was downloaded and a recovery snapshot was saved in Recent Deletions.`
          : action === "keep"
            ? `${result.data.affected} assigned ${noun} marked reviewed.`
            : `${result.data.affected} ${noun} assigned to ${duplicateReviewTarget}${duplicateReviewAsFresh ? " as Fresh Leads; previous history is retained" : " with current statuses retained"}.`,
        type: "success",
      });
      setSelectedDuplicateReviewIds([]);
      await refreshDuplicateReviews();
      router.refresh();
    } catch {
      setDuplicateReviewError("The review action could not be completed. Refresh the list and try again.");
    } finally {
      setIsResolvingDuplicateReviews(false);
    }
  }

  useEffect(() => {
    if (!canDelete) return;
    const initialLoad = window.setTimeout(() => void refreshDuplicateReviews(), 0);
    const timer = window.setInterval(() => void refreshDuplicateReviews(), 60_000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(timer);
    };
  }, [canDelete, refreshDuplicateReviews]);

  async function processImportedRows(parsedData: ImportRow[], fileName: string) {
    try {
      const plainData = JSON.parse(JSON.stringify(parsedData));
      const response = await bulkInsertLeads(plainData, fileName);
      if (!response.success) {
        toast.add({ title: "Import failed", description: response.error, type: "error" });
        return;
      }

      const { leads: importedLeads, skippedDuplicates, skippedRows, unassigned, duplicateReviewCaptureError } = response.data;
      // Mark imported rows as self-mutations so realtime notifications don't
      // toast the admin about their own bulk import.
      trackLeadMutations(importedLeads.map((lead) => lead.id));
      setServerTotal((current) => current + importedLeads.length);

      // Avoid rendering hundreds of newly imported table rows locally or
      // making a second count request just to confirm the import. Revalidation
      // refreshes the current server-paginated view.
      const filtersAreActive = Boolean(hasLeadFilters(filters) || activeSearch.trim() || activeStatusFilter.trim());
      const assignedCount = Math.max(0, importedLeads.length - unassigned);
      const importSummary = [
        `${importedLeads.length.toLocaleString()} added`,
        assignedCount ? `${assignedCount.toLocaleString()} assigned` : "",
        skippedDuplicates
          ? duplicateReviewCaptureError
            ? `${skippedDuplicates.toLocaleString()} duplicates skipped; review capture failed`
            : `${skippedDuplicates.toLocaleString()} duplicates sent for review`
          : "",
        skippedRows ? `${skippedRows.toLocaleString()} invalid rows skipped` : "",
        unassigned ? `${unassigned.toLocaleString()} need assignment` : "",
        importedLeads.length > 0 && filtersAreActive ? "some new leads may be hidden by current filters" : "",
      ].filter(Boolean).join(" · ");

      toast.add({
        title: "Import complete",
        description:
          importedLeads.length === 0
            ? `No new leads were added — all ${skippedDuplicates} phone numbers already exist in the database.${skippedRows > 0 ? ` ${skippedRows} invalid rows were also skipped.` : ""}`
            : `${importSummary}.`,
        type: "success",
      });

      if (skippedDuplicates > 0 && !duplicateReviewCaptureError) await refreshDuplicateReviews(true);
      if (duplicateReviewCaptureError) {
        toast.add({ title: "Duplicate review could not be saved", description: duplicateReviewCaptureError, type: "error" });
      }

      router.refresh();
    } catch {
      toast.add({ title: "Import failed", description: "Something went wrong while importing the file.", type: "error" });
    } finally {
      setIsImporting(false);
    }
  }

  function handleImport(file: File) {
    setIsImporting(true);
    const extension = file.name.split(".").pop()?.toLowerCase();

    if (extension === "csv") {
      Papa.parse<unknown[]>(file, {
        skipEmptyLines: "greedy",
        complete: (result) => {
          if (result.errors.length > 0) {
            setIsImporting(false);
            toast.add({ title: "Import could not be read", description: result.errors[0].message, type: "error" });
            return;
          }
          const rows = leadImportGridToRecords(result.data) as ImportRow[];
          if (rows.length === 0) {
            setIsImporting(false);
            toast.add({
              title: "Lead headers not recognized",
              description: "The CSV needs a header row with a name, phone, email, or other lead column.",
              type: "error",
            });
            return;
          }
          void processImportedRows(rows, file.name);
        },
        error: (error) => {
          setIsImporting(false);
          toast.add({ title: "Import failed", description: error.message, type: "error" });
        },
      });
      return;
    }

    if (extension === "xlsx" || extension === "xls") {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const buffer = event.target?.result;
          if (!(buffer instanceof ArrayBuffer)) {
            throw new Error("Unable to read the Excel file.");
          }

          const XLSX = await import("xlsx");
          const workbook = XLSX.read(buffer, { type: "array" });
          if (workbook.SheetNames.length === 0) {
            throw new Error("The Excel file does not contain a worksheet.");
          }

          const sheets = workbook.SheetNames.map((sheetName) => {
            const worksheet = workbook.Sheets[sheetName];
            const grid = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
              header: 1,
              defval: "",
              raw: false,
            });
            const headerRow = findLeadImportHeaderRow(grid);
            return {
              sheetName,
              rows: leadImportGridToRecords(grid) as ImportRow[],
              recognizedFields: headerRow < 0
                ? []
                : getRecognizedLeadImportFields(
                    grid[headerRow].map((cell) => String(cell ?? "").trim()),
                  ),
            };
          });
          const bestSheet = sheets
            .filter((sheet) => sheet.rows.length > 0)
            .sort(
              (left, right) =>
                right.recognizedFields.length * 10000 + right.rows.length -
                (left.recognizedFields.length * 10000 + left.rows.length),
            )[0];
          if (!bestSheet) {
            throw new Error("No worksheet had a recognizable lead header. Include a name, phone, or email column.");
          }
          void processImportedRows(bestSheet.rows, `${file.name} (${bestSheet.sheetName})`);
        } catch (error) {
          setIsImporting(false);
          toast.add({
            title: "Import failed",
            description: error instanceof Error ? error.message : "Unable to read the Excel file.",
            type: "error",
          });
        }
      };
      reader.onerror = () => {
        setIsImporting(false);
        toast.add({ title: "Import failed", description: "Unable to read the Excel file.", type: "error" });
      };
      reader.readAsArrayBuffer(file);
      return;
    }

    setIsImporting(false);
    toast.add({ title: "Unsupported file", description: "Please upload a CSV or Excel file.", type: "error" });
  }

  // "Magic Paste": parses the pasted TSV and runs it through the SAME import
  // pipeline as CSV/Excel files — flexible header mapping, "-" fallbacks for
  // missing fields, duplicate phone checks against Supabase (duplicates are
  // skipped), chunked bulk insert, success toast and automatic table refresh.
  function handleMagicPaste() {
    const rows = parsePastedTable(pastedData);
    if (rows.length === 0) {
      toast.add({
        title: "Lead headers not recognized",
        description:
          "Paste the table with its column headers. Supported headers include name/patient, phone/mobile, city/location, treatment, date, source, status and remarks.",
        type: "error",
      });
      return;
    }
    setIsPasteOpen(false);
    setPastedData("");
    setIsImporting(true);
    void processImportedRows(rows, "Magic Paste");
  }

  async function handleCreateLead(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setIsCreatingLead(true);
    const formData = new FormData(form);
    const response = await createLead({
      name: String(formData.get("name") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      email: String(formData.get("email") ?? ""),
      gender: String(formData.get("gender") ?? ""),
      city: String(formData.get("city") ?? ""),
      disease: String(formData.get("disease") ?? ""),
      insurance_status: String(formData.get("insurance_status") ?? ""),
      remarks: String(formData.get("remarks") ?? ""),
      follow_up_date: String(formData.get("follow_up_date") ?? ""),
      status: String(formData.get("status") ?? "New"),
    });
    if (!response.success) {
      toast.add({ title: "Unable to add lead", description: response.error, type: "error" });
      if (response.code === "duplicate-phone") {
        setIsAddLeadOpen(false);
        await refreshDuplicateReviews(true);
      }
    } else {
      trackLeadMutations(response.data.id);
      setLeads((currentLeads) => [response.data, ...currentLeads]);
      setServerTotal((current) => current + 1);
      setIsAddLeadOpen(false);
      form.reset();
      queueSuccessSummary("added");
    }
    setIsCreatingLead(false);
  }

  async function handleStatusChange(lead: Lead, status: string | null) {
    if (!status || status === lead.status || savingLeadIds.has(lead.id)) return;
    trackLeadMutations(lead.id);
    setLeadSaving(lead.id, true);
    patchLeadLocally(lead.id, { status });
    const response = await updateLeadStatus({ id: lead.id, status });
    if (!response.success) {
      updateLeadLocally(lead);
      toast.add({ title: "Status update failed", description: response.error, type: "error" });
    } else {
      updateLeadLocally(response.data);
      queueSuccessSummary("updated");
      // Gamification: the surgery stage ("Won", "IPD Done", "Surgery Completed")
      // fires confetti + a reward toast — but only on the way IN, so toggling
      // between two winning statuses doesn't spam the celebration.
      if (stageForStatus(status) === "surgery" && stageForStatus(lead.status) !== "surgery") {
        celebrateLeadWin({ name: response.data.name || lead.name, status });
      }
    }
    setLeadSaving(lead.id, false);
  }

  /**
   * The date box that appears when a lead's status owns a date.
   *
   * Which column it writes to is NOT decided here — `appointmentForStatus` owns
   * that, so the Leads row, the drawer and the calendar can never disagree
   * about what "OPD Booked" means. This component only renders and saves.
   *
   * Renders nothing for a status with no date, which is what keeps the table
   * tidy: only the three OPD/IPD statuses grow a date row.
   */
  function AppointmentDateInput({ lead }: { lead: Lead }) {
    const [saving, setSaving] = useState(false);
    // Captured into a non-null local: TypeScript cannot carry the `if (!field)`
    // narrowing into the `save` closure below, so it would otherwise widen back
    // to `AppointmentField | null` on every use.
    const field = appointmentForStatus(lead.status);
    if (!field) return null;
    const column = field.column;

    const current = normaliseAppointmentDate((lead as unknown as Record<string, string>)[column]);

    async function save(next: string) {
      if (next === current || savingLeadIds.has(lead.id)) return;
      setSaving(true);
      setLeadSaving(lead.id, true);
      patchLeadLocally(lead.id, { [column]: next });
      const response = await updateLeadAppointment({ id: lead.id, column, value: next });
      setSaving(false);
      if (!response.success) {
        patchLeadLocally(lead.id, { [column]: current });
        toast.add({ title: "Date not saved", description: response.error, type: "error" });
        setLeadSaving(lead.id, false);
        return;
      }
      updateLeadLocally(response.data);
      queueSuccessSummary("updated");
      setLeadSaving(lead.id, false);
    }

    return (
      <div className="space-y-0.5">
        <label className="block text-[10px] font-medium tracking-wide text-slate-500 uppercase">
          {field.label}
        </label>
        <AppointmentDatePicker
          value={current}
          label={field.label}
          hint={field.hint}
          disabled={saving || savingLeadIds.has(lead.id)}
          onChange={(value) => void save(value)}
        />
      </div>
    );
  }

  async function handleAssignmentChange(lead: Lead, employeeName: string | null) {
    if (!employeeName || employeeName === lead.assigned_to || savingLeadIds.has(lead.id)) return;
    setTransferDisposition("keep");
    setPendingLeadTransfer({ lead, employeeName });
  }

  async function confirmSingleLeadTransfer() {
    if (!pendingLeadTransfer || isBulkActionPending) return;
    const { lead, employeeName } = pendingLeadTransfer;
    setIsBulkActionPending(true);
    trackLeadMutations(lead.id);
    setLeadSaving(lead.id, true);
    patchLeadLocally(lead.id, { assigned_to: employeeName });
    const response = await updateLeadAssignment(lead.id, employeeName, transferDisposition === "fresh");
    if (!response.success) {
      updateLeadLocally(lead);
      toast.add({ title: "Assignment update failed", description: response.error, type: "error" });
    } else {
      updateLeadLocally(response.data);
      setPendingLeadTransfer(null);
      router.refresh();
      toast.add({ title: "Lead transferred", description: transferDisposition === "fresh" ? "Sent as a Fresh Lead. Previous history is retained." : "Current status and history were retained.", type: "success" });
    }
    setLeadSaving(lead.id, false);
    setIsBulkActionPending(false);
  }

  function toggleLeadSelection(leadId: string, selected: boolean) {
    setSelectedLeads((current) => selected ? [...new Set([...current, leadId])] : current.filter((id) => id !== leadId));
    // Individually deselecting a lead cancels the "select all" (delete-all) mode.
    if (!selected) setIsSelectAllChecked(false);
  }

  async function handleAssignSelected(employeeName: string | null) {
    if (!employeeName || employeeName === "-") return;
    setIsBulkActionPending(true);
    trackLeadMutations(selectedLeads);
    const response = await assignLeadsToEmployees({ leadIds: selectedLeads, employeeNames: [employeeName] });
    if (!response.success) {
      toast.add({ title: "Assignment failed", description: response.error, type: "error" });
    } else {
      setLeads((current) => current.map((lead) => selectedLeads.includes(lead.id) ? { ...lead, assigned_to: employeeName } : lead));
      setSelectedLeads([]);
      setIsSelectAllChecked(false);
      router.refresh();
      queueSuccessSummary("assigned", response.data.assigned);
    }
    setIsBulkActionPending(false);
  }

  async function handleRandomAssign() {
    setIsBulkActionPending(true);
    trackLeadMutations(selectedLeads);
    const response = await randomAssignLeads(selectedLeads);
    if (!response.success) {
      toast.add({ title: "Distribution failed", description: response.error, type: "error" });
    } else {
      setSelectedLeads([]);
      setIsSelectAllChecked(false);
      router.refresh();
      queueSuccessSummary("assigned", response.data.assigned);
    }
    setIsBulkActionPending(false);
  }

  function openAssignment(mode: "selected" | "transfer-selected" | "filters" | "add-to-batch", batch: LeadAssignmentBatch | null = null) {
    assignmentSuggestionSequenceRef.current += 1;
    setAssignmentMode(mode);
    setAssignmentBatchTarget(batch);
    setAssignmentEmployeeNames([]);
    setAssignmentCriteria({ search: "", treatment: "", city: "", status: "", includeAssigned: false, excludeBatchId: mode === "add-to-batch" ? batch?.id : undefined });
    setAssignmentSuggestions([]);
    setSelectedAssignmentLeads([]);
    setSelectAllAssignmentMatches(false);
    setAssignmentSuggestionTotal(0);
    setHasMoreAssignmentSuggestions(false);
    setIsLoadingAssignmentSuggestions(false);
    setAssignmentSuggestionError("");
    setTransferLeadIds(mode === "transfer-selected" ? selectedLeads : []);
    setTransferSourceEmployee("");
    setTransferLeads([]);
    setTransferLeadTotal(0);
    setTransferLeadPage(0);
    setTransferLeadError("");
    setTransferDisposition("keep");
    setIsLoadingTransferLeads(false);
    setIsSelectingAllTransferLeads(false);
    setIsAssignmentOpen(true);
  }

  async function loadEmployeeTransferPage(employeeName: string, page: number) {
    const requestId = ++transferLeadSequenceRef.current;
    setIsLoadingTransferLeads(true);
    setTransferLeadError("");
    try {
      const response = await getEmployeeLeadsForTransfer(employeeName, page * 25);
      if (requestId !== transferLeadSequenceRef.current) return;
      if (!response.success) {
        setTransferLeadError(response.error);
        setTransferLeads([]);
        setTransferLeadTotal(0);
        return;
      }
      setTransferLeads(response.data.leads);
      setTransferLeadTotal(response.data.total);
    } catch (error) {
      if (requestId !== transferLeadSequenceRef.current) return;
      setTransferLeadError(error instanceof Error ? error.message : "Unable to load employee leads.");
      setTransferLeads([]);
      setTransferLeadTotal(0);
    } finally {
      if (requestId === transferLeadSequenceRef.current) setIsLoadingTransferLeads(false);
    }
  }

  async function selectAllEmployeeTransferLeads() {
    if (!transferSourceEmployee || isSelectingAllTransferLeads) return;
    setIsSelectingAllTransferLeads(true);
    setTransferLeadError("");
    try {
      const response = await getEmployeeLeadsForTransfer(transferSourceEmployee, 0, true);
      if (!response.success) {
        setTransferLeadError(response.error);
        return;
      }
      setTransferLeadIds((current) => [...new Set([...current, ...response.data.leadIds])]);
    } catch (error) {
      setTransferLeadError(error instanceof Error ? error.message : "Unable to select all employee leads.");
    } finally {
      setIsSelectingAllTransferLeads(false);
    }
  }

  function toggleAssignmentEmployee(name: string, checked: boolean) {
    setAssignmentEmployeeNames((current) =>
      checked ? [...new Set([...current, name])] : current.filter((entry) => entry !== name),
    );
  }

  function updateAssignmentCriteria(patch: Partial<LeadAssignmentCriteria>) {
    setAssignmentCriteria((current) => ({ ...current, ...patch }));
    setSelectAllAssignmentMatches(false);
    setSelectedAssignmentLeads([]);
    setIsLoadingAssignmentSuggestions(false);
    assignmentSuggestionSequenceRef.current += 1;
    setAssignmentSuggestions([]);
    setAssignmentSuggestionTotal(0);
    setHasMoreAssignmentSuggestions(false);
    setAssignmentSuggestionError("");
  }

  const fetchAssignmentSuggestions = useCallback(
    async (criteria: LeadAssignmentCriteria, offset = 0) => {
      const requestId = ++assignmentSuggestionSequenceRef.current;
      setIsLoadingAssignmentSuggestions(true);
      setAssignmentSuggestionError("");
      try {
        const response = await getUnassignedLeadAssignmentSuggestions(criteria, offset);
        if (requestId !== assignmentSuggestionSequenceRef.current) return;
        if (!response.success) {
          setAssignmentSuggestionError(response.error);
          setHasMoreAssignmentSuggestions(false);
          return;
        }
        setAssignmentSuggestions((current) => {
          if (offset === 0) return response.data.leads;
          const seen = new Set(current.map((lead) => lead.id));
          return [...current, ...response.data.leads.filter((lead) => !seen.has(lead.id))];
        });
        setAssignmentSuggestionTotal(response.data.total);
        setHasMoreAssignmentSuggestions(response.data.hasMore);
      } catch (error) {
        if (requestId !== assignmentSuggestionSequenceRef.current) return;
        setAssignmentSuggestionError(
          error instanceof Error ? error.message : "Unable to reach the server. Please try again.",
        );
        setHasMoreAssignmentSuggestions(false);
      } finally {
        if (requestId === assignmentSuggestionSequenceRef.current) {
          setIsLoadingAssignmentSuggestions(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (!isAssignmentOpen || assignmentMode === "selected" || assignmentMode === "transfer-selected") return;
    const criteria = {
      search: assignmentCriteria.search.trim(),
      treatment: assignmentCriteria.treatment.trim(),
      city: assignmentCriteria.city.trim(),
      status: assignmentCriteria.status?.trim() ?? "",
      includeAssigned: assignmentCriteria.includeAssigned === true,
      excludeBatchId: assignmentCriteria.excludeBatchId,
    };
    const timer = setTimeout(() => {
      void fetchAssignmentSuggestions(criteria);
    }, 250);
    return () => {
      clearTimeout(timer);
      assignmentSuggestionSequenceRef.current += 1;
    };
  }, [
    assignmentCriteria.city,
    assignmentCriteria.search,
    assignmentCriteria.status,
    assignmentCriteria.includeAssigned,
    assignmentCriteria.excludeBatchId,
    assignmentCriteria.treatment,
    assignmentMode,
    fetchAssignmentSuggestions,
    isAssignmentOpen,
  ]);

  async function handleAssignAmongSelectedEmployees() {
    const assignAllMatches = assignmentMode === "filters" && selectAllAssignmentMatches;
    const leadIdsToAssign = assignmentMode === "transfer-selected"
      ? transferLeadIds
      : assignmentMode === "selected"
        ? selectedLeads
      : assignAllMatches ? [] : selectedAssignmentLeads.map((lead) => lead.id);
    if ((assignmentMode !== "add-to-batch" && assignmentEmployeeNames.length === 0) || (!assignAllMatches && leadIdsToAssign.length === 0) || isBulkActionPending) return;
    setIsBulkActionPending(true);
    try {
      if (leadIdsToAssign.length > 0) trackLeadMutations(leadIdsToAssign);
      if (assignmentMode === "add-to-batch" && assignmentBatchTarget) {
        const response = await addLeadsToAssignmentBatch({ batchId: assignmentBatchTarget.id, leadIds: leadIdsToAssign });
        if (!response.success) {
          toast.add({ title: "Unable to add leads to batch", description: response.error, type: "error" });
        } else {
          setIsAssignmentOpen(false);
          setSelectedAssignmentLeads([]);
          setSelectAllAssignmentMatches(false);
          router.refresh();
          const perEmployee = response.data.perEmployee.map((entry) => `${entry.name}: ${entry.count}`).join(" · ");
          queueSuccessSummary("assigned", response.data.added, perEmployee);
          void refreshAssignmentBatches();
        }
        return;
      }
      const response = await assignLeadsToEmployees({
        ...(assignAllMatches ? { criteria: assignmentCriteria } : { leadIds: leadIdsToAssign }),
        employeeNames: assignmentEmployeeNames,
        ...(assignmentMode !== "add-to-batch" ? { asFresh: transferDisposition === "fresh" } : {}),
      });
      if (!response.success) {
        toast.add({ title: assignmentMode === "transfer-selected" ? "Transfer failed" : "Assignment failed", description: response.error, type: "error" });
      } else {
        if (assignmentMode === "selected" || assignmentMode === "transfer-selected") {
          setSelectedLeads([]);
          setIsSelectAllChecked(false);
          setTransferLeadIds([]);
        } else {
          setSelectedAssignmentLeads([]);
          setSelectAllAssignmentMatches(false);
        }
        setIsAssignmentOpen(false);
        router.refresh();
        const perEmployee = response.data.perEmployee.map((entry) => `${entry.name}: ${entry.count}`).join(" · ");
        if (assignmentMode === "transfer-selected") {
          toast.add({ title: "Leads transferred", description: `${response.data.assigned.toLocaleString()} leads moved${perEmployee ? ` — ${perEmployee}` : ""}${transferDisposition === "fresh" ? ". Sent as Fresh Leads; previous history is retained." : ". Current statuses and history were retained."}`, type: "success" });
        } else {
          queueSuccessSummary("assigned", response.data.assigned, perEmployee);
        }
      }
    } catch (error) {
      toast.add({
        title: assignmentMode === "transfer-selected" ? "Transfer failed" : "Assignment failed",
        description: error instanceof Error ? error.message : "Unable to reach the server. Please try again.",
        type: "error",
      });
    } finally {
      setIsBulkActionPending(false);
    }
  }

  async function refreshAssignmentBatches() {
    setIsLoadingAssignmentBatches(true);
    setAssignmentBatchError("");
    const response = await getLeadAssignmentBatches();
    if (!response.success) setAssignmentBatchError(response.error);
    else setAssignmentBatches(response.data);
    setIsLoadingAssignmentBatches(false);
  }

  async function openAssignmentBatches() {
    setIsAssignmentBatchesOpen(true);
    await refreshAssignmentBatches();
  }

  async function confirmAssignmentBatchAction() {
    if (!assignmentBatchAction || isAssignmentBatchActionPending) return;
    setIsAssignmentBatchActionPending(true);
    try {
      const { batch, kind } = assignmentBatchAction;
      if (kind === "delete") {
        const backup = await getLeadsForAssignmentBatch(batch.id);
        if (!backup.success || backup.data.length === 0) {
          toast.add({
            title: "Batch deletion cancelled",
            description: backup.success ? "No active leads were found in this batch." : `An Excel backup could not be prepared. ${backup.error}`,
            type: "error",
          });
          return;
        }
        await downloadLeadsExcel(
          backup.data,
          `assignment-batch-backup-${batch.label.replace(/[^a-z0-9]+/gi, "-")}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.xlsx`,
        );
        const response = await deleteLeadAssignmentBatch(batch.id);
        if (!response.success) {
          toast.add({ title: "Batch deletion failed", description: response.error, type: "error" });
        } else {
          toast.add({ title: "Assignment batch deleted", description: `${response.data.deleted.toLocaleString()} leads removed. An Excel file and recovery snapshot were saved.`, type: "success" });
          setAssignmentBatchAction(null);
          router.refresh();
          await refreshAssignmentBatches();
        }
      } else {
        const employeeName = assignmentBatchTargets[batch.id] ?? "";
        const response = await transferLeadAssignmentBatch({ batchId: batch.id, employeeName, asFresh: transferDisposition === "fresh" });
        if (!response.success) {
          toast.add({ title: "Batch transfer failed", description: response.error, type: "error" });
        } else {
          toast.add({ title: "Assignment batch transferred", description: `${response.data.transferred.toLocaleString()} leads moved to ${employeeName}${transferDisposition === "fresh" ? " as Fresh Leads; previous history is retained" : " with their current statuses"}.`, type: "success" });
          setAssignmentBatchAction(null);
          router.refresh();
          await refreshAssignmentBatches();
        }
      }
    } finally {
      setIsAssignmentBatchActionPending(false);
    }
  }

  async function openSourceBatchDeletion() {
    setIsSourceDeleteOpen(true);
    setIsLoadingSourceBatches(true);
    setSourceBatches([]);
    setSelectedSourceBatchKeys([]);
    setSourceBatchLoadError("");
    try {
      const response = await getLeadSourceBatches();
      if (!response.success) {
        setSourceBatchLoadError(response.error);
        toast.add({ title: "Could not load import batches", description: response.error, type: "error" });
      } else {
        setSourceBatches(response.data);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to reach the server. Please try again.";
      setSourceBatchLoadError(message);
      toast.add({
        title: "Could not load import batches",
        description: message,
        type: "error",
      });
    } finally {
      setIsLoadingSourceBatches(false);
    }
  }

  const selectedSourceBatches = sourceBatches.filter((batch) =>
    selectedSourceBatchKeys.includes(sourceBatchKey(batch)),
  );
  const selectedSourceBatchLeadCount = selectedSourceBatches.reduce((sum, batch) => sum + batch.count, 0);

  async function handleDeleteSourceBatches() {
    if (selectedSourceBatches.length === 0 || isDeletingSource) return;
    setIsDeletingSource(true);
    try {
      const batchRefs = selectedSourceBatches.map(({ id, source }) => ({ id, source }));
      const backup = await getLeadsForSourceBatches(batchRefs);
      if (!backup.success) {
        toast.add({
          title: "Batch deletion cancelled",
          description: `An Excel backup could not be prepared. ${backup.error}`,
          type: "error",
        });
        return;
      }
      const batchLabel = selectedSourceBatches.length === 1
        ? selectedSourceBatches[0].label
        : `${selectedSourceBatches.length} selected batches`;
      await downloadLeadsExcel(
        backup.data,
        `leads-batch-backup-${batchLabel.replace(/[^a-z0-9]+/gi, "-")}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.xlsx`,
      );
      const response = await deleteLeadSourceBatches(batchRefs);
      if (!response.success) {
        toast.add({ title: "Batch deletion failed", description: response.error, type: "error" });
        return;
      }
      setIsSourceDeleteOpen(false);
      setSelectedSourceBatchKeys([]);
      router.refresh();
      toast.add({
        title: "Import batches deleted",
        description: `${response.data.deleted.toLocaleString()} leads from ${response.data.batches} batch${response.data.batches === 1 ? "" : "es"} were deleted. An Excel file and recovery snapshot were saved.`,
        type: "success",
      });
    } catch (error) {
      toast.add({
        title: "Batch deletion failed",
        description: error instanceof Error ? error.message : "Unable to reach the server. Please try again.",
        type: "error",
      });
    } finally {
      setIsDeletingSource(false);
    }
  }

  // A scoped delete (one employee / one search) already can't touch more than
  // what is on screen, so only the true whole-table wipe needs typing.
  const requiresTypedConfirm =
    isSelectAllChecked &&
    !assignedTo.trim() &&
    !activeSearch.trim() &&
    !filters.assignmentStatus;
  const deleteAllIsScoped = Boolean(
    activeSearch.trim() || assignedTo.trim() || activeStatusFilter || hasLeadFilters(filters),
  );

  async function handleBulkDelete() {
    // When "select all" is active, delete with a single { deleteAll: true }
    // request instead of shipping thousands of IDs. If a server-side search is
    // active, the backend wipes only the leads matching that search.
    const deleteAll = isSelectAllChecked;
    if (requiresTypedConfirm && deleteConfirmText.trim().toUpperCase() !== DELETE_ALL_CONFIRMATION) {
      toast.add({
        title: "Confirmation required",
        description: `Type ${DELETE_ALL_CONFIRMATION} in the box to delete every lead.`,
        type: "error",
      });
      return;
    }
    setIsBulkActionPending(true);
    // SAFETY NET #1 (always): write every row this delete will remove to a local
    // CSV BEFORE touching the database. Only the admin-only export can do a
    // 5k-row read, so a manager gets the "ask an admin" path for a full wipe
    // instead of silently unrecoverable data loss.
    // SAFETY NET #2 (server): bulkDeleteLeads stores a snapshot in
    // lead_deletion_backups when that migration has been applied.
    const backupScope = deleteAll ? activeSearch : "";
    const backup = deleteAll
      ? await getLeadsForExport(backupScope, activeStatusFilter, assignedTo, filters)
      : await getLeadsForExport("", "", "", undefined, selectedLeads);
    if (backup.success) {
      await downloadLeadsExcel(backup.data, `leads-backup-before-delete-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.xlsx`);
    } else {
      toast.add({
        title: "Delete cancelled — Excel backup could not be prepared",
        description: `${backup.error} Nothing was deleted. Try again or export the leads first.`,
        type: "error",
      });
      setIsBulkActionPending(false);
      return;
    }
    const response = await bulkDeleteLeads(
      deleteAll ? [] : selectedLeads,
      deleteAll,
      activeSearch,
      assignedTo,
      deleteConfirmText,
      filters,
      activeStatusFilter,
    );
    if (!response.success) {
      toast.add({ title: "Delete failed", description: response.error, type: "error" });
      setIsBulkActionPending(false);
      return;
    }
    const deletedCount = response.data.deleted;
    if (deleteAll) {
      setLeads([]);
      setPage(1);
      setServerTotal(0);
      setServerTotalPages(1);
    } else {
      setLeads((current) => current.filter((lead) => !selectedLeads.includes(lead.id)));
      const remaining = Math.max(0, serverTotal - deletedCount);
      const nextTotalPages = Math.max(1, Math.ceil(remaining / LEADS_PAGE_SIZE));
      setServerTotal(remaining);
      setServerTotalPages(nextTotalPages);
      // The current page was the last one and is now empty — load the new last page.
      if (page > nextTotalPages) {
        await fetchPage(nextTotalPages);
      }
    }
    setSelectedLeads([]);
    setIsSelectAllChecked(false);
    setIsDeleteConfirmOpen(false);
    setDeleteConfirmText("");
    // Sync the server-rendered stat cards after revalidatePath on the server.
    router.refresh();
    toast.add({
      title: "Leads deleted",
      description: `${
        deleteAll
          ? activeSearch
            ? `All ${deletedCount} leads matching the search were deleted`
            : `All ${deletedCount} leads were deleted`
          : `${deletedCount} leads deleted`
      }.${
        response.data.snapshotSkipped
          ? ""
          : ' A snapshot was saved — "Recent Deletions" can restore them.'
      }`,
      type: "success",
    });
    if (response.data.snapshotSkipped) {
      toast.add({
        title: "Undo is not available yet",
        description: `${deletedCount} leads were deleted, but no snapshot could be stored. ${LEAD_DELETION_BACKUP_SETUP_HINT}`,
        type: "error",
      });
    }
    setIsBulkActionPending(false);
  }

  /** Loads the newest bulk-delete snapshots so an admin can undo one. */
  async function openRestoreDialog() {
    setIsRestoreOpen(true);
    setIsLoadingBackups(true);
    setBackupErrorText("");
    const response = await getLeadDeletionBackups();
    if (!response.success) {
      // Usually means the snapshot migration hasn't been applied yet — the
      // message says exactly which SQL file to run, and deletion keeps working.
      setBackupErrorText(response.error);
      setDeletionBackups([]);
    } else {
      setDeletionBackups(response.data);
    }
    setIsLoadingBackups(false);
  }

  async function handleRestoreBackup(backupId: string) {
    setRestoringBackupId(backupId);
    const response = await restoreLeadDeletionBackup(backupId);
    if (!response.success) {
      toast.add({ title: "Restore failed", description: response.error, type: "error" });
    } else {
      setDeletionBackups((current) =>
        current.map((backup) =>
          backup.id === backupId ? { ...backup, restored_at: new Date().toISOString() } : backup,
        ),
      );
      router.refresh();
      toast.add({
        title: "Leads restored",
        description: `${response.data.restored} leads were put back. Leads page refreshes automatically.`,
        type: "success",
      });
    }
    setRestoringBackupId(null);
  }

  async function handleDownloadDeletionBackup(backup: LeadDeletionBackup) {
    if (downloadingBackupId) return;
    setDownloadingBackupId(backup.id);
    try {
      const response = await getLeadDeletionBackupForExport(backup.id);
      if (!response.success) {
        toast.add({ title: "Backup download failed", description: response.error, type: "error" });
        return;
      }
      const label = backup.scope.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "leads";
      const date = new Date(backup.created_at).toISOString().slice(0, 19).replace(/[:T]/g, "-");
      await downloadLeadsExcel(response.data, `${label}-deletion-backup-${date}.xlsx`);
      toast.add({ title: "Excel backup ready", description: `${response.data.length.toLocaleString()} leads downloaded.`, type: "success" });
    } catch (error) {
      toast.add({ title: "Backup download failed", description: error instanceof Error ? error.message : "The Excel file could not be created.", type: "error" });
    } finally {
      setDownloadingBackupId(null);
    }
  }

  async function handleDeleteBackup() {
    if (!backupPendingDeletion) return;
    const backupId = backupPendingDeletion.id;
    setDeletingBackupId(backupId);
    try {
      const response = await permanentlyDeleteLeadDeletionBackup(backupId);
      if (!response.success) {
        toast.add({ title: "Snapshot deletion failed", description: response.error, type: "error" });
      } else {
        setDeletionBackups((current) => current.filter((backup) => backup.id !== backupId));
        setBackupPendingDeletion(null);
        toast.add({
          title: "Snapshot permanently deleted",
          description: "Its recovery copy was removed. Active leads were not changed.",
          type: "success",
        });
      }
    } catch (error) {
      toast.add({
        title: "Snapshot deletion failed",
        description: error instanceof Error ? error.message : "Unable to reach the server. Please try again.",
        type: "error",
      });
    } finally {
      setDeletingBackupId(null);
    }
  }

  async function handleQuickNote() {
    if (!quickNoteLead || !quickNote.trim()) return;
    trackLeadMutations(quickNoteLead.id);
    setIsSavingQuickNote(true);
    const response = await addLeadActivity({ lead_id: quickNoteLead.id, action_type: "Note", description: quickNote.trim() });
    if (!response.success) {
      toast.add({ title: "Unable to save note", description: response.error, type: "error" });
    } else {
      const updatedLead = { ...quickNoteLead, remarks: [quickNoteLead.remarks === "-" ? "" : quickNoteLead.remarks, quickNote.trim()].filter(Boolean).join("\n") };
      setLeads((currentLeads) => currentLeads.map((lead) => lead.id === updatedLead.id ? updatedLead : lead));
      if (selectedLead?.id === updatedLead.id) setSelectedLead(updatedLead);
      setQuickNoteLead(null);
      setQuickNote("");
      queueSuccessSummary("notes");
    }
    setIsSavingQuickNote(false);
  }

  async function handleViewLead(lead: Lead) {
    setSelectedLead(lead);
    setLeadEdits({
      city: lead.city === "-" ? "" : lead.city,
      disease: lead.disease === "-" ? "" : lead.disease,
      insurance_status: lead.insurance_status === "-" ? "" : lead.insurance_status,
      remarks: lead.remarks === "-" ? "" : lead.remarks,
    });
    setActivities([]);
    setNote("");
    setIsLoadingActivities(true);
    const response = await getLeadActivities(lead.id);
    if (!response.success) {
      toast.add({ title: "Unable to load timeline", description: response.error, type: "error" });
    } else {
      setActivities(response.data);
    }
    setIsLoadingActivities(false);
  }

  useEffect(() => {
    if (!initialOpenLeadId || autoOpenedLeadIdRef.current === initialOpenLeadId) return;
    const lead = leads.find((candidate) => candidate.id === initialOpenLeadId);
    if (!lead) return;

    // Defer opening until after the route's initial render to keep state changes
    // out of the effect itself and ensure the populated Leads table is mounted.
    const frame = window.requestAnimationFrame(() => {
      autoOpenedLeadIdRef.current = initialOpenLeadId;
      void handleViewLead(lead);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initialOpenLeadId, leads]);

  async function handleSaveLeadEdits() {
    if (!selectedLead) return;
    trackLeadMutations(selectedLead.id);
    setIsSavingEdits(true);
    const previousLead = selectedLead;
    const optimisticLead: Lead = canEditCore
      ? { ...selectedLead, ...leadEdits }
      : { ...selectedLead, remarks: leadEdits.remarks || "-" };
    updateLeadLocally(optimisticLead);
    const response = await updateLeadDetails({ id: selectedLead.id, ...leadEdits });
    if (!response.success) {
      updateLeadLocally(previousLead);
      toast.add({ title: "Unable to save changes", description: response.error, type: "error" });
    } else {
      const updated = response.data;
      updateLeadLocally(updated);
      queueSuccessSummary("updated");
    }
    setIsSavingEdits(false);
  }

  function handleEditLead(lead: Lead) {
    setEditingLead(lead);
    setEditTransferAsFresh(false);
    setEditForm({
      name: lead.name && lead.name !== "-" ? lead.name : "",
      phone: lead.phone && lead.phone !== "-" ? lead.phone : "",
      email: lead.email && lead.email !== "-" ? lead.email : "",
      gender: lead.gender && lead.gender !== "-" ? lead.gender : "",
      city: lead.city === "-" ? "" : lead.city,
      disease: lead.disease === "-" ? "" : lead.disease,
      insurance_status: lead.insurance_status === "-" ? "" : lead.insurance_status,
      remarks: lead.remarks === "-" ? "" : lead.remarks,
      assigned_to: lead.assigned_to && lead.assigned_to !== "-" ? lead.assigned_to : "",
      status: canonicalLeadStatus(lead.status),
      // Date input needs ISO format; unparseable stored values start empty.
      lead_date: parseLeadDateForSort(lead.lead_date) || "",
      follow_up_date: parseLeadDateForSort(lead.follow_up_date) || "",
      source: lead.source && lead.source !== "-" ? lead.source : "",
    });
  }

  async function handleSaveEdit() {
    if (!editingLead) return;
    trackLeadMutations(editingLead.id);
    setIsSavingEdit(true);
    const assignmentChanged = editForm.assigned_to !== (editingLead.assigned_to && editingLead.assigned_to !== "-" ? editingLead.assigned_to : "");
    const transferAsFresh = canEditCore && assignmentChanged && Boolean(editForm.assigned_to) && editTransferAsFresh;
    // Patient details are editable for employees; only source and assignment
    // remain server-side protected for their role.
    const payload = canEditCore
      ? { id: editingLead.id, ...editForm, transfer_as_fresh: transferAsFresh }
      : {
          id: editingLead.id,
          name: editForm.name,
          phone: editForm.phone,
          email: editForm.email,
          gender: editForm.gender,
          city: editForm.city,
          disease: editForm.disease,
          insurance_status: editForm.insurance_status,
          lead_date: editForm.lead_date,
          follow_up_date: editForm.follow_up_date,
          remarks: editForm.remarks,
          status: editForm.status,
        };
    const optimisticLead: Lead = canEditCore
      ? {
          ...editingLead,
          ...editForm,
          phone: editForm.phone || "-",
          email: editForm.email || "-",
          gender: editForm.gender || "-",
          city: editForm.city || "-",
          disease: editForm.disease || "-",
          insurance_status: editForm.insurance_status || "-",
          assigned_to: editForm.assigned_to || "-",
          lead_date: editForm.lead_date || "-",
          follow_up_date: editForm.follow_up_date || "-",
          source: editForm.source || "-",
        }
      : {
          ...editingLead,
          name: editForm.name,
          phone: editForm.phone || "-",
          email: editForm.email || "-",
          gender: editForm.gender || "-",
          city: editForm.city || "-",
          disease: editForm.disease || "-",
          insurance_status: editForm.insurance_status || "-",
          lead_date: editForm.lead_date || "-",
          follow_up_date: editForm.follow_up_date || "-",
          status: editForm.status,
          remarks: editForm.remarks || "-",
        };
    const optimisticResult = transferAsFresh ? { ...optimisticLead, status: "New", follow_up_date: "-" } : optimisticLead;
    updateLeadLocally(optimisticResult);
    const response = await updateLeadDetails(payload);
    if (!response.success) {
      updateLeadLocally(editingLead);
      toast.add({ title: "Unable to save changes", description: response.error, type: "error" });
    } else {
      const updated = response.data;
      // Smooth refresh: swap the saved row into the table state — no page reload.
      updateLeadLocally(updated);
      setEditingLead(null);
      queueSuccessSummary("updated");
      // Keep the server-rendered stat cards (New/Hot counts) in sync.
      router.refresh();
    }
    setIsSavingEdit(false);
  }

  async function handleAddNote() {
    if (!selectedLead || !note.trim()) return;
    setIsAddingNote(true);
    trackLeadMutations(selectedLead.id);
    const response = await addLeadActivity({ lead_id: selectedLead.id, action_type: "Note", description: note.trim() });
    if (!response.success) {
      toast.add({ title: "Unable to add note", description: response.error, type: "error" });
    } else {
      const refreshedActivities = await getLeadActivities(selectedLead.id);
      if (refreshedActivities.success) setActivities(refreshedActivities.data);
      setNote("");
      queueSuccessSummary("notes");
    }
    setIsAddingNote(false);
  }

  async function handleFollowUpChange(lead: Lead, followUpDate: string) {
    if (savingLeadIds.has(lead.id)) return;
    trackLeadMutations(lead.id);
    setLeadSaving(lead.id, true);
    patchLeadLocally(lead.id, { follow_up_date: followUpDate || "-" });
    const response = await updateLeadFollowUpDate(lead.id, followUpDate);
    if (!response.success) {
      updateLeadLocally(lead);
      toast.add({ title: "Unable to update follow-up", description: response.error, type: "error" });
    } else {
      updateLeadLocally(response.data);
      queueSuccessSummary("updated");
    }
    setLeadSaving(lead.id, false);
  }

  return (
    <>
      <Card className="border-0 shadow-sm">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-lg">Lead Management</CardTitle>
            <p className="mt-1 text-sm text-slate-500">Review and update your sales pipeline.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input ref={fileInputRef} type="file" accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel" className="hidden" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) handleImport(file);
              event.target.value = "";
            }} />
            <CallingWorkspace leads={leads} />
            {canBulkUpload && (
              <>
            <Button type="button" variant="outline" disabled={isImporting} onClick={() => fileInputRef.current?.click()}>
                  {isImporting ? <Loader2 className="animate-spin" aria-hidden="true" /> : <FileUp aria-hidden="true" />}
                  {isImporting ? "Importing..." : "Import CSV / Excel"}
                </Button>
                <Button type="button" variant="outline" disabled={isImporting} onClick={() => setIsPasteOpen(true)}>
                  <ClipboardPaste aria-hidden="true" />
                  Paste from Excel
                </Button>
              </>
            )}
            {isAdmin && (
              <Button type="button" variant="outline" disabled={isExporting} onClick={() => void handleExportCsv()}>
                {isExporting ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
                {isExporting ? "Preparing..." : "Download CSV"}
              </Button>
            )}
            {canDelete && (
              <Button type="button" variant="outline" onClick={() => void openRestoreDialog()}>
                <RotateCcw aria-hidden="true" />
                Recent Deletions
              </Button>
            )}
            {canDelete && (
              <Button type="button" variant={duplicateReviewItems.length > 0 ? "secondary" : "outline"} onClick={() => void openDuplicateReviews()}>
                {isLoadingDuplicateReviews ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <UserRoundPlus aria-hidden="true" />}
                Duplicate Reviews
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${duplicateReviewItems.length > 0 ? "bg-emerald-700 text-white" : "bg-slate-100 text-slate-600"}`}>
                  {duplicateReviewItems.length.toLocaleString()}
                </span>
              </Button>
            )}
            {canDelete && (
              <Button type="button" variant="outline" onClick={() => openAssignment("transfer-selected")}>
                <ArrowRightLeft aria-hidden="true" />
                Transfer Leads
              </Button>
            )}
            {canDelete && (
              <Button type="button" variant="outline" onClick={() => openAssignment("filters")}>
                <UserRoundPlus aria-hidden="true" />
                Assign by Filters
              </Button>
            )}
            {canDelete && (
              <Button type="button" variant="outline" onClick={() => void openAssignmentBatches()}>
                <Users aria-hidden="true" />
                Assignment Batches
              </Button>
            )}
            {isAdmin && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void openSourceBatchDeletion()}
              >
                <Trash2 aria-hidden="true" />
                Delete Import Batches
              </Button>
            )}
            <Button type="button" onClick={() => setIsAddLeadOpen(true)}><Plus aria-hidden="true" />Add Lead</Button>
          </div>
          <div className="space-y-3 border-t border-slate-100 pt-4">
            {hasLeadFilters(filters) && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
                <span className="text-xs font-semibold text-blue-700">Chart filter</span>
                {drillDownChips(filters).map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={() => router.push(leadsHref({ ...filters, ...chip.next }))}
                    className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-white px-2.5 py-1 text-xs font-medium text-blue-700 transition-colors hover:border-blue-300 hover:bg-blue-100"
                    aria-label={`Remove filter: ${chip.label}`}
                  >
                    {chip.label}
                    <X className="size-3" aria-hidden="true" />
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => router.push("/dashboard/leads")}
                  className="ml-auto text-xs font-semibold text-blue-600 underline-offset-2 hover:underline"
                >
                  Clear all
                </button>
              </div>
            )}

            {/* Age buckets — Today → 1 day → 2…7 days → 1/2/3 weeks. One click
                rewrites ?age= and refetches. The month picker next to it replaces
                the old vague "Month" chip, so picking a month clears the age. */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs font-semibold text-slate-500">Lead age</span>
              {AGE_CHIP_BUCKETS.map((bucket) => {
                const isActive = filters.age === bucket.key;
                return (
                  <button
                    key={bucket.key}
                    type="button"
                    aria-pressed={isActive}
                    title={`Leads added ${bucket.label.toLowerCase()}`}
                    onClick={() =>
                      router.push(
                        leadsHref({ ...filters, age: isActive ? "" : bucket.key, month: "" }),
                      )
                    }
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                      isActive
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    {bucket.short}
                  </button>
                );
              })}
              {/* The month itself, shown as a chip here (the picker lives in the
                  page-level AgeStrip) so the active month is always visible. */}
              {filters.month && (
                <button
                  type="button"
                  aria-pressed="true"
                  title={`Leads from ${monthFilterLabel(filters.month)} — click to remove this filter`}
                  onClick={() => router.push(leadsHref({ ...filters, month: "" }))}
                  className="rounded-full border border-blue-600 bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition-colors"
                >
                  {monthFilterLabel(filters.month)}
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-56 flex-1 sm:max-w-xs">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <Input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search ALL leads: name, phone, treatment..."
                  aria-label="Search leads by name, phone or treatment"
                  className="pl-9"
                />
              </div>

              <Select value={selectedStatus} onValueChange={(value) => handleStatusFilterSelect(typeof value === "string" ? value : "all")}>
                <SelectTrigger className="w-44" aria-label="Filter by status"><SelectValue placeholder="All Statuses" /></SelectTrigger>
                <SelectContent className="max-h-72 overflow-y-auto">
                  <SelectItem value="all">All Statuses</SelectItem>
                  {statuses.map((option) => (
                    <SelectItem key={option} value={option}>{option}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {canSeeSource && (
                <Select value={selectedSource} onValueChange={(value) => setSelectedSource(typeof value === "string" ? value : "all")}>
                  <SelectTrigger className="w-44" aria-label="Filter by source"><SelectValue placeholder="All Sources" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Sources</SelectItem>
                    {masterSourceOptions.map((source) => <SelectItem key={source} value={source}>{source}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}


              <Popover open={isDatePopoverOpen} onOpenChange={setIsDatePopoverOpen}>
                <PopoverTrigger
                  render={
                    <Button
                      type="button"
                      variant={dateFilter ? "default" : "outline"}
                      size="sm"
                      className="gap-2"
                      aria-label="Filter by date"
                    >
                      <CalendarDays className="size-4" aria-hidden="true" />
                      {dateFilter
                        ? `${dateFilter.dateField === "follow_up_date" ? "Follow-Up" : "Lead"}: ${dateFrom || "start"} → ${dateTo || "end"}`
                        : "Date Filter"}
                    </Button>
                  }
                />
                <PopoverContent className="w-72 space-y-3" align="start">
                  <div className="space-y-1.5">
                    <Label htmlFor="date-filter-field">Filter on</Label>
                    <Select value={dateField} onValueChange={(value) => setDateField(value === "follow_up_date" ? "follow_up_date" : "lead_date")}>
                      <SelectTrigger id="date-filter-field" className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="lead_date">Lead Date (added on)</SelectItem>
                        <SelectItem value="follow_up_date">Follow-Up Date</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="date-filter-from">From</Label>
                      <Input id="date-filter-from" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="date-filter-to">To</Label>
                      <Input id="date-filter-to" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
                    </div>
                  </div>
                  <p className="text-xs text-slate-500">Tip: Set From and To to the same date to filter for a specific day.</p>
                  <div className="flex justify-between gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); }}>
                      Clear dates
                    </Button>
                    <Button type="button" size="sm" onClick={() => setIsDatePopoverOpen(false)}>
                      Done
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={resetFilters}
                disabled={!hasActiveFilters}
                aria-label="Reset all filters"
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                Reset Filters
              </Button>
            </div>

            {activeFilterChips.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                {activeFilterChips.map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={chip.onRemove}
                    className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-100"
                    aria-label={`Remove filter: ${chip.label}`}
                  >
                    {chip.label}
                    <X className="size-3" aria-hidden="true" />
                  </button>
                ))}
                <span className="text-xs text-slate-400">
                  {activeSearch
                    ? `${serverTotal.toLocaleString()} leads match the search`
                    : `${filteredLeads.length} of ${serverTotal.toLocaleString()} leads match`}
                </span>
              </div>
            )}
          </div>
        </CardHeader>
        {canDelete && selectedLeads.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-y border-slate-200 bg-slate-50 px-4 py-3">
            <span className="mr-2 text-sm font-medium text-slate-600">{selectedLeads.length} selected</span>
            <Select onValueChange={(value) => void handleAssignSelected(typeof value === "string" ? value : null)} disabled={isBulkActionPending}>
              <SelectTrigger size="sm" className="w-40"><SelectValue placeholder="Assign Selected" /></SelectTrigger>
              <SelectContent>{employees.map((employee) => <SelectItem key={employee.id} value={employee.name}>{employee.name}</SelectItem>)}</SelectContent>
            </Select>
            <Button type="button" variant="outline" size="sm" disabled={isBulkActionPending} onClick={() => openAssignment("transfer-selected")}>
              <ArrowRightLeft aria-hidden="true" />Transfer Selected
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={isBulkActionPending} onClick={() => openAssignment("selected")}>
              <UserRoundPlus aria-hidden="true" />Split among employees
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={isBulkActionPending} onClick={() => void handleRandomAssign()}><Dices aria-hidden="true" />Distribute Equally</Button>
            <Button type="button" variant="destructive" size="sm" disabled={isBulkActionPending} onClick={() => setIsDeleteConfirmOpen(true)}><Trash2 aria-hidden="true" />Delete Selected</Button>
          </div>
        )}
        <CardContent>
          <Table className="min-w-[1480px] table-fixed">
            <TableHeader><TableRow>
              {canDelete && <TableHead className="w-10"><input type="checkbox" aria-label="Select all leads" checked={isSelectAllChecked} onChange={(event) => { const checked = event.target.checked; setIsSelectAllChecked(checked); setSelectedLeads(checked ? [...new Set([...selectedLeads, ...sortedLeads.map((lead) => lead.id)])] : selectedLeads.filter((id) => !sortedLeads.some((lead) => lead.id === id))); }} /></TableHead>}
              <SortableTableHead className="w-[250px]" label="Patient" sortKey="name" sortConfig={sortConfig} onSort={toggleSort} />
              <TableHead className="w-[150px]">Contact</TableHead>
              <SortableTableHead className="w-[130px]" label="Lead Date" sortKey="lead_date" sortConfig={sortConfig} onSort={toggleSort} />
              <TableHead className="w-[140px]">City</TableHead>
              <TableHead className="w-[150px]">Surgery / Treatment</TableHead>
              <SortableTableHead className="w-[180px]" label="Status" sortKey="status" sortConfig={sortConfig} onSort={toggleSort} />
              <TableHead className="w-[180px]">Temp</TableHead>
              <SortableTableHead className="w-[180px]" label="Assigned To" sortKey="assigned_to" sortConfig={sortConfig} onSort={toggleSort} />
              <TableHead className="w-[250px] max-w-[250px]">Remarks</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {sortedLeads.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="py-10">
                    {/*
                      Never look broken: distinguish "the database is empty" from
                      "your filters hide everything", and put the fix (import /
                      add / clear filters) one click away.
                    */}
                    <div className="flex flex-col items-center gap-3 text-center">
                      <div className="rounded-full bg-slate-100 p-3">
                        {isPipelineEmpty ? (
                          <FileUp className="size-5 text-slate-500" aria-hidden="true" />
                        ) : (
                          <SearchX className="size-5 text-slate-500" aria-hidden="true" />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-700">
                          {isPipelineEmpty ? "The pipeline is empty" : "No leads match the current view"}
                        </p>
                        <p className="mx-auto mt-1 max-w-xl text-xs text-slate-500">
                          {isPipelineEmpty
                            ? "No leads are stored in the database yet. Import your Excel/CSV sheet (or paste rows straight from Excel) and they appear here instantly."
                            : `${serverTotal.toLocaleString()} leads exist in the pipeline, but the current search / filters hide all of them. Clear the filters to see them.`}
                        </p>
                        {isPipelineEmpty && canDelete && (
                          <p className="mx-auto mt-2 max-w-xl text-xs text-slate-400">
                            {"Deleted leads by mistake? Re-import the Excel backup downloaded before deletion, or restore an admin snapshot from \"Recent Deletions\"."}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap justify-center gap-2">
                        {isPipelineEmpty ? (
                          <>
                            {canBulkUpload && (
                              <Button type="button" size="sm" onClick={() => fileInputRef.current?.click()}>
                                <FileUp aria-hidden="true" />Import CSV / Excel
                              </Button>
                            )}
                            {canBulkUpload && (
                              <Button type="button" size="sm" variant="outline" onClick={() => setIsPasteOpen(true)}>
                                <ClipboardPaste aria-hidden="true" />Paste from Excel
                              </Button>
                            )}
                            <Button type="button" size="sm" variant="outline" onClick={() => setIsAddLeadOpen(true)}>
                              <Plus aria-hidden="true" />Add Lead
                            </Button>
                          </>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              // One place clears the filters (it also refetches
                              // page 1 when the search/status hit the server).
                              resetFilters();
                              setIsSelectAllChecked(false);
                              router.push(assignedTo ? `/dashboard/leads?assigned=${encodeURIComponent(assignedTo)}` : "/dashboard/leads");
                            }}
                          >
                            <X aria-hidden="true" />Clear filters
                          </Button>
                        )}
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              ) : sortedLeads.map((lead) => {
                // Fresh leads get a green row + NEW pill; every row carries the
                // "Added yesterday / 2 days ago / 1 week ago" label.
                const isNew = isNewLead(lead.lead_date);
                const leadStatus = canonicalLeadStatus(lead.status);
                const statusBadgeClass = leadStatus === "New"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : leadStatus.startsWith("OPD")
                    ? "border-sky-200 bg-sky-50 text-sky-700"
                    : leadStatus.startsWith("IPD")
                      ? "border-violet-200 bg-violet-50 text-violet-700"
                      : leadStatus === "Dropped"
                          ? "border-rose-200 bg-rose-50 text-rose-700"
                          : "border-slate-200 bg-slate-50 text-slate-600";
                const ageLabel = relativeLeadAge(lead.lead_date);
                const treatment = treatmentCellData(lead);
                return (
                <TableRow key={lead.id} className={isNew ? "bg-emerald-50/50" : undefined}>
                  {canDelete && <TableCell className="w-10 py-3"><input type="checkbox" aria-label={`Select ${lead.name}`} checked={selectedLeads.includes(lead.id)} onChange={(event) => toggleLeadSelection(lead.id, event.target.checked)} /></TableCell>}
                  <TableCell className="w-[250px] max-w-[250px] py-3"><div className="flex items-center gap-1.5"><button type="button" className="min-w-0 flex-1 truncate text-left font-semibold text-slate-900 hover:underline" onClick={() => handleViewLead(lead)}>{lead.name}</button><button type="button" aria-label={`Edit ${lead.name}`} title="Edit lead" className="shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700" onClick={() => handleEditLead(lead)}><Pencil className="size-3.5" aria-hidden="true" /></button></div><Badge className={`mt-1 w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusBadgeClass}`}>{leadStatus === "New" ? "Fresh" : leadStatus}</Badge>{lead.had_previous_assignment && <Badge className="ml-1 mt-1 w-fit rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700">Previous history</Badge>}<p className="max-w-full break-words whitespace-normal text-xs text-muted-foreground">{lead.email}</p>{canSeeSource && <Badge className={`mt-1 ${sourceBadgeClass(lead.source)}`}>{lead.source}</Badge>}</TableCell>
                  <TableCell className="min-w-[130px]">
                    <span className="font-medium tabular-nums">
                      <PhonePreview value={lead.phone} className="text-sm text-slate-700" />
                    </span>
                  </TableCell>
                  <TableCell className="w-[130px] max-w-[130px] py-3">
                    <div className="space-y-0.5">
                      <p className="flex items-center gap-1 font-semibold text-slate-900">
                        <CalendarDays className="size-4 shrink-0 text-slate-500" aria-hidden="true" />
                        {formatLeadDateDisplay(lead.lead_date)}
                      </p>
                      <p className={`text-[11px] ${isNew ? "font-semibold text-emerald-700" : "text-slate-500"}`}>
                        {ageLabel ?? "No date"}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="w-[140px] max-w-[140px] py-3"><p className="break-words whitespace-normal text-sm text-slate-700">{lead.city}</p></TableCell>
                  <TableCell className="w-[150px] max-w-[150px] overflow-hidden py-3 whitespace-normal">
                    <div className="flex min-w-0 items-start gap-1.5">
                      <span
                        className="mt-1 size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: treatmentColor(treatment.key) }}
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-sm font-medium text-slate-800 [overflow-wrap:anywhere]">{treatment.label}</p>
                        {treatment.detail && (
                          <p className="mt-0.5 line-clamp-2 text-xs text-slate-500 [overflow-wrap:anywhere]">
                            {treatment.detail}
                          </p>
                        )}
                        {(treatment.hasSummary || treatment.label.length > 40 || treatment.detail.length > 60) && (
                          <button type="button" onClick={() => handleViewLead(lead)} className="mt-1 rounded text-xs font-medium text-emerald-700 hover:underline focus-visible:outline-2 focus-visible:outline-emerald-700" aria-label={`View treatment details for ${lead.name}`}>
                            View details
                          </button>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="w-[180px] py-3">
                    <div className="space-y-1.5">
                      <Select value={canonicalLeadStatus(lead.status)} onValueChange={(value) => handleStatusChange(lead, value)} disabled={savingLeadIds.has(lead.id)}>
                        <SelectTrigger size="sm" aria-label={`Status for ${lead.name}`} className="w-full max-w-[170px]"><SelectValue /></SelectTrigger>
                        <SelectContent className="max-h-72 overflow-y-auto">{statuses.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent>
                      </Select>
                      {savingLeadIds.has(lead.id) && (
                        <span className="text-[10px] text-blue-600" aria-live="polite">
                          Saving...
                        </span>
                      )}
                      {/* Won is derived, not stored — reaching an OPD or IPD IS
                          the win, so this badge can never drift from the
                          status sitting right above it. */}
                      {isWonStatus(lead.status) && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                          Won
                        </span>
                      )}
                      <AppointmentDateInput lead={lead} />
                    </div>
                  </TableCell>
                  <TableCell className="w-[180px] py-3"><Select value={lead.assigned_to} onValueChange={(value) => handleAssignmentChange(lead, value)} disabled={savingLeadIds.has(lead.id)}>
                    <SelectTrigger size="sm" className="w-full max-w-[170px]"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                    <SelectContent><SelectItem value="-">Unassigned</SelectItem>{employees.map((employee) => <SelectItem key={employee.id} value={employee.name}>{employee.name}</SelectItem>)}</SelectContent>
                  </Select></TableCell>
                  <TableCell className="w-[250px] max-w-[250px] py-3"><div className="flex max-w-full items-start gap-2"><span className="line-clamp-2 min-w-0 break-words whitespace-normal text-xs text-slate-600" title={lead.remarks === "-" ? "" : lead.remarks}>{lead.remarks === "-" ? "" : lead.remarks}</span><Button type="button" variant="ghost" size="xs" className="shrink-0 whitespace-nowrap px-1.5" onClick={() => setQuickNoteLead(lead)}>✏️ Note</Button></div></TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <div className="mt-4 flex flex-col items-center justify-between gap-3 border-t border-slate-100 pt-4 sm:flex-row">
            <p className="text-sm text-slate-500">
              {serverTotal > 0
                ? `Showing ${(page - 1) * LEADS_PAGE_SIZE + 1}–${(page - 1) * LEADS_PAGE_SIZE + leads.length} of ${serverTotal.toLocaleString()} leads`
                : "No leads to display"}
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={page <= 1 || isPaging} onClick={() => void handlePageChange(page - 1)}>
                <ChevronLeft aria-hidden="true" />Previous
              </Button>
              <span className="px-1 text-sm text-slate-500" aria-live="polite">Page {page} of {serverTotalPages}</span>
              <Button type="button" variant="outline" size="sm" disabled={page >= serverTotalPages || isPaging} onClick={() => void handlePageChange(page + 1)}>
                Next<ChevronRight aria-hidden="true" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isPasteOpen} onOpenChange={setIsPasteOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Paste from Excel / Google Sheets</DialogTitle>
            <DialogDescription>
              Paste copied cells or delimited text with headers. Header rows can be below a title; duplicate phone numbers are skipped.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
            <p className="font-medium">
              Headers can use common names such as Patient / Customer, Mobile / WhatsApp, City / Location, Treatment / Query, Date, Source, Status, or Notes. Columns can be in any order.
            </p>
            <p className="mt-1">Any other filled-in columns are kept in the lead remarks so form answers are not lost.</p>
            {pastePreview.rowCount > 0 && (
              <p className="mt-1">
                {pastePreview.recognized.length > 0
                  ? `Detected columns: ${pastePreview.recognized.join(", ")}.`
                  : "No recognized column headers found — include column headers such as Name, Phone, or Email."}
              </p>
            )}
          </div>
          <Textarea
            value={pastedData}
            onChange={(event) => setPastedData(event.target.value)}
            rows={12}
            autoFocus
            className="font-mono text-xs"
            aria-label="Pasted Excel data"
            placeholder={"Name\tContact no\tCity\tTreatment\tRemarks\tDate\nJohn Doe\t9876543210\tDelhi\tKnee Pain\tFollow up Monday\t15/01/2026"}
            onPaste={(event) => event.stopPropagation()}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsPasteOpen(false)}>Cancel</Button>
            <Button type="button" disabled={isImporting || pastePreview.rowCount === 0} onClick={handleMagicPaste}>
              {isImporting && <Loader2 className="animate-spin" aria-hidden="true" />}
              {isImporting ? "Adding leads..." : pastePreview.rowCount > 0 ? `Add ${pastePreview.rowCount} Leads` : "Add Leads"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isAddLeadOpen} onOpenChange={setIsAddLeadOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Add Lead</DialogTitle><DialogDescription>Create a new lead for your pipeline.</DialogDescription></DialogHeader>
          <form onSubmit={handleCreateLead} className="space-y-4">
            <div className="space-y-2"><Label htmlFor="lead-name">Name</Label><Input id="lead-name" name="name" required autoComplete="name" /></div>
            <div className="space-y-2"><Label htmlFor="lead-phone">Phone</Label><Input id="lead-phone" name="phone" type="tel" autoComplete="tel" /></div>
            <div className="space-y-2"><Label htmlFor="lead-email">Email</Label><Input id="lead-email" name="email" type="email" autoComplete="email" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label htmlFor="lead-gender">Gender</Label><Input id="lead-gender" name="gender" /></div>
              <div className="space-y-2"><Label htmlFor="lead-city">City</Label><Input id="lead-city" name="city" /></div>
              <div className="space-y-2"><Label htmlFor="lead-disease">Disease</Label><Input id="lead-disease" name="disease" /></div>
              <div className="space-y-2"><Label htmlFor="lead-insurance-status">Insurance Status</Label><Input id="lead-insurance-status" name="insurance_status" /></div>
            </div>
            <div className="space-y-2"><Label htmlFor="lead-status">Status</Label><Select name="status" defaultValue="New"><SelectTrigger id="lead-status"><SelectValue /></SelectTrigger><SelectContent className="max-h-72 overflow-y-auto">{statuses.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label htmlFor="lead-remarks">Remarks</Label><Textarea id="lead-remarks" name="remarks" rows={3} /></div>
            <div className="space-y-2"><Label htmlFor="lead-follow-up-date">Next Follow-Up Date</Label><Input id="lead-follow-up-date" name="follow_up_date" type="date" className="w-full cursor-pointer" onClick={(event) => event.currentTarget.showPicker?.()} /></div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setIsAddLeadOpen(false)}>Cancel</Button><Button type="submit" disabled={isCreatingLead}>{isCreatingLead ? "Adding..." : "Add Lead"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isSelectAllChecked ? "Delete ALL leads?" : "Delete selected leads?"}</DialogTitle>
            <DialogDescription>
              {isSelectAllChecked
                ? `This deletes ALL ${serverTotal.toLocaleString()} leads ${
                    deleteAllIsScoped ? "matching the current filters" : "in your pipeline"
                  } and their related activity history. A backup snapshot is taken first, so you can undo it from "Recent Deletions".`
                : `This deletes ${selectedLeads.length} selected leads and their related activity history. A backup snapshot is taken first, so you can undo it from "Recent Deletions".`}
            </DialogDescription>
          </DialogHeader>
          {requiresTypedConfirm && (
            <div className="grid gap-2">
              <Label htmlFor="delete-all-confirmation">
                Type <span className="font-semibold">{DELETE_ALL_CONFIRMATION}</span> to confirm
              </Label>
              <Input
                id="delete-all-confirmation"
                value={deleteConfirmText}
                autoComplete="off"
                placeholder={DELETE_ALL_CONFIRMATION}
                onChange={(event) => setDeleteConfirmText(event.target.value)}
              />
            </div>
          )}
          <DialogFooter><Button type="button" variant="outline" onClick={() => { setIsDeleteConfirmOpen(false); setDeleteConfirmText(""); }}>Cancel</Button><Button type="button" variant="destructive" disabled={isBulkActionPending || (requiresTypedConfirm && deleteConfirmText.trim().toUpperCase() !== DELETE_ALL_CONFIRMATION)} onClick={() => void handleBulkDelete()}>{isBulkActionPending ? "Deleting..." : isSelectAllChecked ? (activeSearch ? "Delete All Matching" : "Delete All Leads") : "Delete Leads"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={isAssignmentOpen}
        onOpenChange={(open) => {
          if (!isBulkActionPending) setIsAssignmentOpen(open);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {assignmentMode === "add-to-batch"
                ? `Add leads to ${assignmentBatchTarget?.label ?? "assignment batch"}`
                : assignmentMode === "transfer-selected" ? "Transfer selected leads" : assignmentMode === "selected" ? "Assign selected leads" : "Find leads to assign"}
            </DialogTitle>
            <DialogDescription>
              {assignmentMode === "add-to-batch"
                ? `Selected leads will be distributed across this batch’s team: ${assignmentBatchTarget?.targetNames.join(", ") || "no active team members"}.`
                : assignmentMode === "transfer-selected"
                  ? `${selectedLeads.length.toLocaleString()} selected leads will move to the team member or members you choose. Their phone numbers and lead details will stay unchanged.`
                  : assignmentMode === "selected"
                  ? `${selectedLeads.length.toLocaleString()} selected leads will be split equally among the employees you choose and saved as one batch.`
                  : assignmentCriteria.includeAssigned
                    ? "Find matching leads by optional filters. Current owners are shown; select only leads you intend to transfer."
                    : "Find unassigned leads by any combination of optional filters. Select the exact records for this batch."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {assignmentMode === "transfer-selected" && (
              <section className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                <div className="space-y-1.5">
                  <Label htmlFor="transfer-source-employee">Choose the employee whose leads you want to move</Label>
                  <Select
                    value={transferSourceEmployee || "choose-employee"}
                    disabled={isBulkActionPending}
                    onValueChange={(value) => {
                      const employeeName = value === "choose-employee" ? "" : String(value ?? "");
                      setTransferSourceEmployee(employeeName);
                      setTransferLeadPage(0);
                      setTransferLeads([]);
                      setTransferLeadTotal(0);
                      setTransferLeadError("");
                      if (employeeName) void loadEmployeeTransferPage(employeeName, 0);
                      else transferLeadSequenceRef.current += 1;
                    }}
                  >
                    <SelectTrigger id="transfer-source-employee" className="w-full"><SelectValue placeholder="Choose an employee" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="choose-employee">Choose an employee</SelectItem>
                      {employees.filter((employee) => employee.role === "employee").map((employee) => (
                        <SelectItem key={employee.id} value={employee.name}>{employee.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 rounded-lg border border-emerald-200 bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-emerald-950" aria-live="polite">{transferLeadIds.length.toLocaleString()} leads selected to transfer</p>
                    {transferLeadIds.length > 0 && <Button type="button" variant="outline" size="sm" disabled={isBulkActionPending} onClick={() => setTransferLeadIds([])}>Clear selection</Button>}
                  </div>
                  <Button type="button" className="w-full" variant="outline" disabled={!transferSourceEmployee || transferLeadTotal === 0 || isSelectingAllTransferLeads || isLoadingTransferLeads || isBulkActionPending} onClick={() => void selectAllEmployeeTransferLeads()}>
                    {isSelectingAllTransferLeads && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
                    {isSelectingAllTransferLeads ? "Selecting all leads…" : transferSourceEmployee ? `Select all ${transferLeadTotal.toLocaleString()} leads for ${transferSourceEmployee}` : "Select all employee leads"}
                  </Button>
                  <p className="text-xs text-slate-600">This selects every lead assigned to this employee, including leads on other pages.</p>
                </div>
                {transferLeadError && <p role="alert" className="rounded-md border border-rose-200 bg-white px-3 py-2 text-sm text-rose-800">{transferLeadError}</p>}
                {transferSourceEmployee && (
                  <>
                    <div className="max-h-[34dvh] space-y-1 overflow-y-auto rounded-lg border border-emerald-200 bg-white p-2">
                      {isLoadingTransferLeads ? (
                        <p className="flex items-center gap-2 px-2 py-5 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" aria-hidden="true" />Loading this employee’s leads…</p>
                      ) : transferLeads.length > 0 ? transferLeads.map((lead) => (
                        <label key={lead.id} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 text-sm hover:bg-emerald-50">
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={transferLeadIds.includes(lead.id)}
                            disabled={isBulkActionPending}
                            onChange={(event) => setTransferLeadIds((current) => event.target.checked ? [...new Set([...current, lead.id])] : current.filter((id) => id !== lead.id))}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium text-slate-900">{lead.name || "Unnamed lead"}</span>
                            <span className="block truncate text-xs text-slate-500">{[lead.status, lead.disease, lead.city, lead.had_previous_assignment ? "Previous history" : ""].filter(Boolean).join(" · ")}</span>
                          </span>
                          {lead.phone ? <PhonePreview value={lead.phone} className="shrink-0 text-xs text-slate-500" /> : null}
                        </label>
                      )) : <p className="px-2 py-5 text-sm text-slate-500">No leads are currently assigned to this employee.</p>}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                        <p className="text-xs font-medium text-slate-600">{transferLeadTotal > 0 ? `Page ${transferLeadPage + 1} of ${Math.max(1, Math.ceil(transferLeadTotal / 25))} · Showing ${transferLeadPage * 25 + 1}–${Math.min((transferLeadPage + 1) * 25, transferLeadTotal)} of ${transferLeadTotal.toLocaleString()}` : "No leads to show"}</p>
                        <div className="flex gap-2">
                          <Button type="button" variant="outline" size="sm" disabled={transferLeadPage === 0 || isLoadingTransferLeads} onClick={() => { const page = transferLeadPage - 1; setTransferLeadPage(page); void loadEmployeeTransferPage(transferSourceEmployee, page); }}>Previous</Button>
                          <Button type="button" variant="outline" size="sm" disabled={(transferLeadPage + 1) * 25 >= transferLeadTotal || isLoadingTransferLeads} onClick={() => { const page = transferLeadPage + 1; setTransferLeadPage(page); void loadEmployeeTransferPage(transferSourceEmployee, page); }}>Next page</Button>
                        </div>
                      </div>
                  </>
                )}
              </section>
            )}

            {assignmentMode !== "selected" && assignmentMode !== "transfer-selected" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="assign-lead-search">Lead name <span className="font-normal text-slate-400">(optional)</span></Label>
                  <Input
                    id="assign-lead-search"
                    value={assignmentCriteria.search}
                    placeholder="Optional: search any part of a lead name"
                    disabled={isBulkActionPending}
                    onChange={(event) => updateAssignmentCriteria({ search: event.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="assign-treatment">Treatment / disease <span className="font-normal text-slate-400">(optional)</span></Label>
                  <Input
                    id="assign-treatment"
                    value={assignmentCriteria.treatment}
                    placeholder="e.g. Cataract"
                    disabled={isBulkActionPending}
                    onChange={(event) => updateAssignmentCriteria({ treatment: event.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="assign-city">City <span className="font-normal text-slate-400">(optional)</span></Label>
                  <Input
                    id="assign-city"
                    value={assignmentCriteria.city}
                    placeholder="e.g. Delhi"
                    disabled={isBulkActionPending}
                    onChange={(event) => updateAssignmentCriteria({ city: event.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="assign-status">Lead status <span className="font-normal text-slate-400">(optional)</span></Label>
                  <Select value={assignmentCriteria.status || "all"} onValueChange={(value) => updateAssignmentCriteria({ status: value === "all" ? "" : String(value ?? "") })}>
                    <SelectTrigger id="assign-status" className="w-full"><SelectValue placeholder="All statuses" /></SelectTrigger>
                    <SelectContent className="max-h-72 overflow-y-auto">
                      <SelectItem value="all">All statuses</SelectItem>
                      {statuses.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm sm:col-span-2">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={assignmentCriteria.includeAssigned === true}
                    disabled={isBulkActionPending}
                    onChange={(event) => updateAssignmentCriteria({ includeAssigned: event.target.checked })}
                  />
                  <span>
                    <span className="block font-medium text-slate-800">Include leads already assigned to someone</span>
                    <span className="block text-xs text-slate-500">Turn this on to intentionally transfer or reassign leads.</span>
                  </span>
                </label>
                <div className="space-y-2 sm:col-span-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label>
                      {assignmentCriteria.includeAssigned ? "Matching leads" : "Matching unassigned leads"}
                      {assignmentSuggestionTotal > 0 && ` (${assignmentSuggestionTotal.toLocaleString()})`}
                    </Label>
                    <div className="flex items-center gap-2">
                      {assignmentMode === "filters" && assignmentSuggestionTotal > 0 && Boolean(
                        assignmentCriteria.search.trim() || assignmentCriteria.treatment.trim() ||
                        assignmentCriteria.city.trim() || assignmentCriteria.status?.trim(),
                      ) && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={isBulkActionPending || isLoadingAssignmentSuggestions}
                          onClick={() => {
                            setSelectedAssignmentLeads([]);
                            setSelectAllAssignmentMatches((current) => !current);
                          }}
                        >
                          {selectAllAssignmentMatches
                            ? "Clear all matching"
                            : `Select all ${assignmentSuggestionTotal.toLocaleString()}`}
                        </Button>
                      )}
                      {isLoadingAssignmentSuggestions && (
                        <span className="inline-flex items-center gap-1.5 text-xs text-slate-500" role="status">
                          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                          Searching…
                        </span>
                      )}
                    </div>
                  </div>
                  {assignmentSuggestionError ? (
                    <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                      {assignmentSuggestionError}
                    </p>
                  ) : assignmentSuggestions.length > 0 ? (
                    <>
                      <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                        {assignmentSuggestions.map((lead) => (
                          <div
                            key={lead.id}
                            className="flex items-start gap-2 rounded-md px-2 py-2 text-sm hover:bg-slate-50"
                          >
                            <input
                              type="checkbox"
                              aria-label={`Select ${lead.name || "lead"}`}
                              className="mt-1"
                              checked={selectedAssignmentLeads.some((selected) => selected.id === lead.id)}
                              disabled={isBulkActionPending}
                              onChange={(event) => {
                                setSelectAllAssignmentMatches(false);
                                setSelectedAssignmentLeads((current) =>
                                  event.target.checked
                                    ? current.some((selected) => selected.id === lead.id)
                                      ? current
                                      : [...current, lead]
                                    : current.filter((selected) => selected.id !== lead.id),
                                );
                              }}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block font-medium text-slate-900">{lead.name || "Unnamed lead"}</span>
                              <span className="block truncate text-xs text-slate-500">
                                {[
                                  lead.status || "New",
                                  lead.assigned_to && lead.assigned_to !== "-" ? `Assigned: ${lead.assigned_to}` : "Unassigned",
                                  lead.disease,
                                  lead.city,
                                  lead.source,
                                ].filter(Boolean).join(" · ") || "No extra details"}
                              </span>
                            </span>
                            {lead.phone ? <PhonePreview value={lead.phone} className="text-xs text-slate-500" /> : null}
                          </div>
                        ))}
                      </div>
                      {hasMoreAssignmentSuggestions && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={isLoadingAssignmentSuggestions || isBulkActionPending}
                          onClick={() =>
                            void fetchAssignmentSuggestions(assignmentCriteria, assignmentSuggestions.length)
                          }
                        >
                          Load more leads
                        </Button>
                      )}
                    </>
                  ) : isLoadingAssignmentSuggestions ? null : assignmentCriteria.search.trim() ||
                    assignmentCriteria.treatment.trim() ||
                    assignmentCriteria.city.trim() ||
                    assignmentCriteria.status?.trim() ? (
                    <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-500">
                      No leads match. Try a different name, status, treatment, city, or assignment filter.
                    </p>
                  ) : (
                    <p className="rounded-lg border border-dashed border-slate-300 px-3 py-3 text-sm text-slate-500">
                      Start typing or choose a status to find matching leads. Names match from the first letter.
                    </p>
                  )}
                  {(selectedAssignmentLeads.length > 0 || selectAllAssignmentMatches) && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-2.5">
                      <p className="mb-1.5 text-xs font-semibold text-blue-900">
                        {selectAllAssignmentMatches
                          ? `All ${assignmentSuggestionTotal.toLocaleString()} matching leads selected`
                          : `${selectedAssignmentLeads.length} lead${selectedAssignmentLeads.length === 1 ? "" : "s"} selected`}
                      </p>
                      <div className="max-h-24 space-y-1 overflow-y-auto">
                        {selectedAssignmentLeads.map((lead) => (
                          <div key={lead.id} className="flex items-center gap-2 text-xs text-blue-900">
                            <input
                              type="checkbox"
                              aria-label={`Remove ${lead.name || "lead"} from selection`}
                              checked
                              disabled={isBulkActionPending}
                              onChange={() =>
                                setSelectedAssignmentLeads((current) =>
                                  current.filter((selected) => selected.id !== lead.id),
                                )
                              }
                            />
                            <span className="min-w-0 truncate">{lead.name}</span>{lead.phone ? <PhonePreview value={lead.phone} className="text-xs text-blue-900" /> : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {(assignmentMode === "selected" || assignmentMode === "transfer-selected") && (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                {assignmentMode === "transfer-selected" ? "Choose the new owner. Selected leads will be reassigned without changing patient details or phone numbers." : "Choose one or more employees. Selected leads will be split evenly among them."}
              </p>
            )}
            {assignmentMode !== "add-to-batch" && <TransferDispositionChoices value={transferDisposition} onChange={setTransferDisposition} disabled={isBulkActionPending} idPrefix="bulk-transfer-disposition" />}

            {assignmentMode !== "add-to-batch" && <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{assignmentMode === "transfer-selected" ? "Transfer to team members" : "Assign to team members"}</Label>
                <button
                  type="button"
                  className="text-xs font-medium text-blue-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isBulkActionPending}
                  onClick={() =>
                    setAssignmentEmployeeNames((current) =>
                      current.length === assignableEmployees.length
                        ? []
                        : assignableEmployees.map((employee) => employee.name),
                    )
                  }
                >
                  Select / clear all
                </button>
              </div>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                {assignableEmployees.map((employee) => (
                  <label
                    key={employee.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      aria-label={`Assign leads to ${employee.name}`}
                      checked={assignmentEmployeeNames.includes(employee.name)}
                      disabled={isBulkActionPending}
                      onChange={(event) => toggleAssignmentEmployee(employee.name, event.target.checked)}
                    />
                    {employee.name}
                    {isAdmin && employee.role !== "employee" && (
                      <span className="text-xs capitalize text-slate-400">{employee.role}</span>
                    )}
                  </label>
                ))}
                {assignableEmployees.length === 0 && (
                  <p className="px-2 py-2 text-xs text-slate-500">No team members are available to assign leads to.</p>
                )}
              </div>
              {assignmentEmployeeNames.length > 0 && (
                <p className="text-xs text-slate-500">
                  {assignmentEmployeeNames.length} team member{assignmentEmployeeNames.length === 1 ? "" : "s"} selected.
                  Leads are split as evenly as possible; the first selected team members get any remainder.
                </p>
              )}
            </div>}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={isBulkActionPending} onClick={() => setIsAssignmentOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                isBulkActionPending ||
                (assignmentMode !== "add-to-batch" && assignmentEmployeeNames.length === 0) ||
                (assignmentMode === "transfer-selected"
                  ? transferLeadIds.length === 0
                  : assignmentMode === "selected"
                  ? selectedLeads.length === 0
                  : assignmentMode === "add-to-batch"
                    ? selectedAssignmentLeads.length === 0
                    : selectedAssignmentLeads.length === 0 && !selectAllAssignmentMatches)
              }
              onClick={() => void handleAssignAmongSelectedEmployees()}
            >
              {isBulkActionPending && <Loader2 className="animate-spin" aria-hidden="true" />}
              {assignmentMode === "add-to-batch"
                ? "Add selected leads to batch"
                : assignmentMode === "transfer-selected"
                  ? "Transfer selected leads"
                  : selectAllAssignmentMatches
                  ? `Assign ${assignmentSuggestionTotal.toLocaleString()} matching leads`
                  : "Assign selected leads"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={isAssignmentBatchesOpen} onOpenChange={setIsAssignmentBatchesOpen}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Assignment batches</DialogTitle>
            <DialogDescription>Each assignment action is grouped here. Open its leads, add more leads, transfer the batch, or safely delete it.</DialogDescription>
          </DialogHeader>
          {isLoadingAssignmentBatches ? (
            <p className="flex items-center gap-2 py-8 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" aria-hidden="true" />Loading assignment batches…</p>
          ) : assignmentBatchError ? (
            <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{assignmentBatchError}</p>
          ) : assignmentBatches.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">No assignment batches yet. The next assignment will appear here automatically.</p>
          ) : (
            <div className="space-y-3">
              {assignmentBatches.map((batch) => (
                <section key={batch.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-slate-900">{batch.label}</h3>
                      <p className="mt-1 text-xs text-slate-500">
                        {new Date(batch.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })} IST · Created by {batch.createdByName}
                      </p>
                      <p className="mt-1 text-xs text-slate-600">Current team: {batch.targetNames.join(", ") || "No team members"} · {batch.activeLeadCount.toLocaleString()} active leads</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => { setIsAssignmentBatchesOpen(false); router.push(leadsHref({ ...filters, assignmentBatchId: batch.id, allMonths: true })); }}>Open leads</Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => { setIsAssignmentBatchesOpen(false); openAssignment("add-to-batch", batch); }}>Add leads</Button>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-col gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:items-center">
                    <Select value={assignmentBatchTargets[batch.id] ?? ""} onValueChange={(value) => setAssignmentBatchTargets((current) => ({ ...current, [batch.id]: String(value ?? "") }))}>
                      <SelectTrigger className="sm:max-w-xs" aria-label={`Choose employee for ${batch.label}`}><SelectValue placeholder="Choose employee to transfer to" /></SelectTrigger>
                      <SelectContent>
                        {assignableEmployees.map((employee) => <SelectItem key={employee.id} value={employee.name}>{employee.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="outline" size="sm" disabled={!assignmentBatchTargets[batch.id] || batch.activeLeadCount === 0} onClick={() => { setTransferDisposition("keep"); setAssignmentBatchAction({ batch, kind: "transfer" }); }}>Transfer batch</Button>
                    {isAdmin && <Button type="button" variant="destructive" size="sm" disabled={batch.activeLeadCount === 0} onClick={() => setAssignmentBatchAction({ batch, kind: "delete" })}><Trash2 aria-hidden="true" />Delete batch</Button>}
                  </div>
                </section>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(assignmentBatchAction)} onOpenChange={(open) => { if (!open && !isAssignmentBatchActionPending) setAssignmentBatchAction(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{assignmentBatchAction?.kind === "delete" ? "Delete this assignment batch?" : "Transfer this assignment batch?"}</DialogTitle>
            <DialogDescription>
              {assignmentBatchAction?.kind === "delete"
                ? `${assignmentBatchAction.batch.activeLeadCount.toLocaleString()} active leads from “${assignmentBatchAction.batch.label}” will be deleted. A recovery snapshot must be saved first.`
                : `${assignmentBatchAction?.batch.activeLeadCount.toLocaleString() ?? 0} active leads from “${assignmentBatchAction?.batch.label ?? ""}” will be assigned to ${assignmentBatchTargets[assignmentBatchAction?.batch.id ?? ""] ?? "the selected employee"}.`}
            </DialogDescription>
          </DialogHeader>
          {assignmentBatchAction?.kind === "transfer" && <TransferDispositionChoices value={transferDisposition} onChange={setTransferDisposition} disabled={isAssignmentBatchActionPending} idPrefix="batch-transfer-disposition" />}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isAssignmentBatchActionPending} onClick={() => setAssignmentBatchAction(null)}>Cancel</Button>
            <Button type="button" variant={assignmentBatchAction?.kind === "delete" ? "destructive" : "default"} disabled={isAssignmentBatchActionPending} onClick={() => void confirmAssignmentBatchAction()}>
              {isAssignmentBatchActionPending && <Loader2 className="animate-spin" aria-hidden="true" />}
              {assignmentBatchAction?.kind === "delete" ? "Delete leads" : "Transfer leads"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={isSourceDeleteOpen}
        onOpenChange={(open) => {
          if (!isDeletingSource) setIsSourceDeleteOpen(open);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Delete specific import batches</DialogTitle>
            <DialogDescription>
              Each Excel/CSV upload, Meta lead, and manual lead is listed separately. Select one or more batches; an Excel file and recovery snapshot are saved before deletion.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {isLoadingSourceBatches ? (
              <p className="flex items-center gap-2 py-6 text-sm text-slate-500">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Loading import batches…
              </p>
            ) : sourceBatchLoadError ? (
              <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-4 text-sm text-rose-800">
                {sourceBatchLoadError}
              </p>
            ) : sourceBatches.length === 0 ? (
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-600">
                No leads are available to delete.
              </p>
            ) : (
              <>
                <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
                  {sourceBatches.map((batch) => {
                    const key = sourceBatchKey(batch);
                    const selected = selectedSourceBatchKeys.includes(key);
                    const wouldExceedLimit =
                      !selected && selectedSourceBatchLeadCount + batch.count > 5000;
                    const batchTime = batch.createdAt ?? batch.firstAddedAt;
                    return (
                      <label
                        key={key}
                        className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors ${
                          selected
                            ? "border-blue-300 bg-blue-50"
                            : "border-slate-200 bg-white hover:bg-slate-50"
                        } ${wouldExceedLimit ? "cursor-not-allowed opacity-50" : ""}`}
                      >
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={selected}
                          disabled={isDeletingSource || wouldExceedLimit}
                          onChange={(event) =>
                            setSelectedSourceBatchKeys((current) =>
                              event.target.checked
                                ? [...current, key]
                                : current.filter((item) => item !== key),
                            )
                          }
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-medium text-slate-900">{batch.label}</span>
                            <span className="text-xs font-semibold tabular-nums text-slate-700">
                              {batch.count.toLocaleString()} leads
                            </span>
                          </span>
                          <span className="mt-1 block text-xs text-slate-500">
                            {batch.legacy
                              ? "Older leads — exact import batch is unknown"
                              : batchTime
                                ? `Added ${new Date(batchTime).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`
                                : "Added time unavailable"}
                          </span>
                          {batch.legacy && (batch.firstAddedAt || batch.lastAddedAt) && (
                            <span className="mt-1 block text-xs text-amber-800">
                              Legacy lead dates:{" "}
                              {batch.firstAddedAt
                                ? new Date(batch.firstAddedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
                                : "unknown"}
                              {" – "}
                              {batch.lastAddedAt
                                ? new Date(batch.lastAddedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
                                : "unknown"}
                              {" "}IST (not exact batch times)
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
                <p className="text-xs text-slate-500">
                  {selectedSourceBatches.length} batch{selectedSourceBatches.length === 1 ? "" : "es"} ·{" "}
                  {selectedSourceBatchLeadCount.toLocaleString()} leads selected.
                  {selectedSourceBatchLeadCount >= 5000 && " The safety limit is 5,000 leads per deletion."}
                </p>
              </>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isDeletingSource} onClick={() => setIsSourceDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={
                selectedSourceBatches.length === 0 ||
                selectedSourceBatchLeadCount > 5000 ||
                isLoadingSourceBatches ||
                isDeletingSource
              }
              onClick={() => void handleDeleteSourceBatches()}
            >
              {isDeletingSource && <Loader2 className="animate-spin" aria-hidden="true" />}
              Delete {selectedSourceBatchLeadCount.toLocaleString()} leads
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={isDuplicateReviewOpen} onOpenChange={(open) => {
        setIsDuplicateReviewOpen(open);
        if (!open && duplicateReviewItems.length > 0) {
          toast.add({ title: "Duplicate review saved", description: `${duplicateReviewItems.length} review${duplicateReviewItems.length === 1 ? "" : "s"} remain pending. Reopen them with the Duplicate Reviews button.` });
        }
      }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Duplicate lead review · {duplicateReviewItems.length.toLocaleString()} pending</DialogTitle>
            <DialogDescription>
              New duplicate rows are blocked. Review the existing lead and its current owner. Closing this window keeps the review here so you can reopen it from the Duplicate Reviews button.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            <p>Unassigned matches are automatically deleted after 24 hours if they remain unresolved. A recovery copy is saved in Recent Deletions. Assigning or transferring a lead stops the timer.</p>
          </div>
          {duplicateReviewError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{duplicateReviewError}</p>}
          {isLoadingDuplicateReviews ? (
            <p className="flex items-center gap-2 py-6 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" aria-hidden="true" />Loading duplicate reviews…</p>
          ) : duplicateReviewItems.length === 0 ? (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-5 text-sm text-slate-600">No duplicate reviews are pending.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-sm font-medium text-slate-800" aria-live="polite">{selectedDuplicateReviewIds.length} selected</p>
                <Button type="button" size="sm" variant="outline" disabled={isResolvingDuplicateReviews} onClick={() => setSelectedDuplicateReviewIds(selectedDuplicateReviewIds.length === duplicateReviewItems.length ? [] : duplicateReviewItems.map((item) => item.id))}>
                  {selectedDuplicateReviewIds.length === duplicateReviewItems.length ? "Clear selection" : `Select all ${duplicateReviewItems.length.toLocaleString()}`}
                </Button>
              </div>
              <div className="max-h-[38dvh] space-y-2 overflow-y-auto pr-1">
                {duplicateReviewItems.map((item) => {
                  const assigned = Boolean(item.lead.assigned_to?.trim() && !["-", "unassigned"].includes(item.lead.assigned_to.trim().toLowerCase()));
                  const remainingMs = new Date(item.expires_at).getTime() - Date.now();
                  const remainingHours = Math.max(0, Math.ceil(remainingMs / (60 * 60 * 1000)));
                  return (
                    <label key={item.id} className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors ${selectedDuplicateReviewIds.includes(item.id) ? "border-emerald-300 bg-emerald-50/60" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
                      <input
                        type="checkbox"
                        className="mt-1 size-4 accent-emerald-700"
                        checked={selectedDuplicateReviewIds.includes(item.id)}
                        disabled={isResolvingDuplicateReviews}
                        onChange={(event) => setSelectedDuplicateReviewIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-slate-900">{item.lead.name || "Unnamed existing lead"}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${assigned ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-900"}`}>
                            {assigned ? `Assigned · ${item.lead.assigned_to}` : "Unassigned"}
                          </span>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">{item.lead.status || "No status"}</span>
                          {item.lead.had_previous_assignment && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700">Previous history</span>}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                          {item.lead.phone && <PhonePreview value={item.lead.phone} />}
                          {item.lead.disease && item.lead.disease !== "-" && <span>{item.lead.disease}</span>}
                          {item.lead.city && item.lead.city !== "-" && <span>{item.lead.city}</span>}
                        </span>
                        <span className="mt-1 block text-xs text-slate-500">
                          Incoming: {item.incoming_name || "Name not provided"} · {item.source} · {item.attempt_count} duplicate attempt{item.attempt_count === 1 ? "" : "s"}
                        </span>
                        <span className={`mt-1 block text-xs ${!assigned ? "font-medium text-amber-800" : "text-slate-500"}`}>
                          {!assigned ? (remainingMs > 0 ? `Auto-delete in about ${remainingHours} hour${remainingHours === 1 ? "" : "s"} unless assigned.` : "Past 24 hours — awaiting the hourly cleanup.") : "No automatic deletion while assigned. Keep, transfer, or delete this lead."}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
              {duplicateReviewTarget && <div className="border-t border-slate-100 pt-3"><TransferDispositionChoices value={duplicateReviewAsFresh ? "fresh" : "keep"} onChange={(value) => setDuplicateReviewAsFresh(value === "fresh")} disabled={isResolvingDuplicateReviews} idPrefix="duplicate-transfer-disposition" /></div>}
              <div className="grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
                <Select value={duplicateReviewTarget || "choose-target"} onValueChange={(value) => setDuplicateReviewTarget(value === "choose-target" ? "" : String(value ?? ""))} disabled={isResolvingDuplicateReviews}>
                  <SelectTrigger aria-label="Assign or transfer selected duplicate leads to" className="w-full"><SelectValue placeholder="Choose an employee" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="choose-target">Choose an employee</SelectItem>
                    {assignableEmployees.map((employee) => <SelectItem key={employee.id} value={employee.name}>{employee.name}{employee.role !== "employee" ? ` · ${employee.role}` : ""}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button type="button" disabled={!selectedDuplicateReviewIds.length || !duplicateReviewTarget || isResolvingDuplicateReviews} onClick={() => void resolveSelectedDuplicateReviews("assign")}>
                  {isResolvingDuplicateReviews && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}Assign / Transfer
                </Button>
                <Button type="button" variant="outline" disabled={!selectedDuplicateReviewIds.length || isResolvingDuplicateReviews || selectedDuplicateReviewIds.some((id) => {
                  const item = duplicateReviewItems.find((candidate) => candidate.id === id);
                  return !item?.lead.assigned_to?.trim() || ["-", "unassigned"].includes(item.lead.assigned_to.trim().toLowerCase());
                })} onClick={() => void resolveSelectedDuplicateReviews("keep")}>Keep assigned</Button>
                <Button type="button" variant="destructive" disabled={!selectedDuplicateReviewIds.length || isResolvingDuplicateReviews} onClick={() => void resolveSelectedDuplicateReviews("delete")}>
                  {isResolvingDuplicateReviews && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}Delete selected
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isRestoreOpen} onOpenChange={setIsRestoreOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Recent Deletions</DialogTitle>
            <DialogDescription>
              Lead details and activities are saved before deletion. Download an Excel copy or restore the snapshot —
              leads that already exist are skipped, so restoring twice is safe.
            </DialogDescription>
          </DialogHeader>
          {isLoadingBackups ? (
            <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="animate-spin" aria-hidden="true" /> Loading deletion history...
            </p>
          ) : backupErrorText ? (
            <div className="rounded-md border border-dashed p-3 text-sm">
              <p className="font-medium">Deletion history is not available yet</p>
              <p className="mt-1 text-muted-foreground">
                Deleting leads still works, but there is nothing to restore from. {LEAD_DELETION_BACKUP_SETUP_HINT}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">{backupErrorText}</p>
            </div>
          ) : deletionBackups.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              No stored deletions yet. Snapshots appear here after a lead or batch is deleted.
            </p>
          ) : (
            <ul className="max-h-80 space-y-2 overflow-y-auto">
              {deletionBackups.map((backup) => (
                <li key={backup.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                  <div className="min-w-0 text-sm">
                    <p className="truncate font-medium">
                      {backup.row_count.toLocaleString()} leads
                      {backup.activity_count ? ` · ${backup.activity_count.toLocaleString()} activities` : ""}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {new Date(backup.created_at).toLocaleString()} · {backup.scope}
                      {backup.search
                        ? ` · ${backup.scope === "source" ? "source" : "search"} "${backup.search}"`
                        : ""} · by {backup.deleted_by_name}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={downloadingBackupId !== null || restoringBackupId === backup.id || deletingBackupId === backup.id}
                      onClick={() => void handleDownloadDeletionBackup(backup)}
                    >
                      {downloadingBackupId === backup.id ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
                      Download Excel
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={Boolean(backup.restored_at) || restoringBackupId === backup.id || deletingBackupId === backup.id || downloadingBackupId === backup.id}
                      onClick={() => void handleRestoreBackup(backup.id)}
                    >
                      {restoringBackupId === backup.id ? (
                        <Loader2 className="animate-spin" aria-hidden="true" />
                      ) : (
                        <RotateCcw aria-hidden="true" />
                      )}
                      {backup.restored_at ? "Restored" : "Restore"}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon"
                      aria-label={`Permanently delete snapshot from ${new Date(backup.created_at).toLocaleString()}`}
                      title="Permanently delete this recovery snapshot"
                      disabled={restoringBackupId === backup.id || deletingBackupId === backup.id || downloadingBackupId === backup.id}
                      onClick={() => setBackupPendingDeletion(backup)}
                    >
                      {deletingBackupId === backup.id ? (
                        <Loader2 className="animate-spin" aria-hidden="true" />
                      ) : (
                        <Trash2 aria-hidden="true" />
                      )}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsRestoreOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(backupPendingDeletion)}
        onOpenChange={(open) => {
          if (!open && deletingBackupId === null) setBackupPendingDeletion(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Permanently delete this snapshot?</DialogTitle>
            <DialogDescription>
              This permanently removes the recovery copy for {backupPendingDeletion?.row_count.toLocaleString() ?? 0} leads
              and cannot be undone. Any leads that have not been restored will no longer be recoverable from this snapshot.
              Active leads are not affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={deletingBackupId !== null}
              onClick={() => setBackupPendingDeletion(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!backupPendingDeletion || deletingBackupId !== null}
              onClick={() => void handleDeleteBackup()}
            >
              {deletingBackupId === backupPendingDeletion?.id ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 aria-hidden="true" />
              )}
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>



      <Dialog open={Boolean(pendingLeadTransfer)} onOpenChange={(open) => !open && !isBulkActionPending && setPendingLeadTransfer(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Transfer {pendingLeadTransfer?.lead.name ?? "lead"}?</DialogTitle>
            <DialogDescription>Choose how {pendingLeadTransfer?.employeeName ?? "the new agent"} should receive this lead. Its previous notes, calls, and appointment history stay available.</DialogDescription>
          </DialogHeader>
          <TransferDispositionChoices value={transferDisposition} onChange={setTransferDisposition} disabled={isBulkActionPending} idPrefix="single-transfer-disposition" />
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isBulkActionPending} onClick={() => setPendingLeadTransfer(null)}>Cancel</Button>
            <Button type="button" disabled={isBulkActionPending} onClick={() => void confirmSingleLeadTransfer()}>{isBulkActionPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ArrowRightLeft aria-hidden="true" />}Transfer lead</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingLead)} onOpenChange={(open) => !open && setEditingLead(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit lead</DialogTitle>
            <DialogDescription>Update patient and lead details for {editingLead?.name}.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label htmlFor="full-edit-name">Patient Name</Label><Input id="full-edit-name" value={editForm.name} onChange={(event) => setEditForm((current) => ({ ...current, name: event.target.value }))} /></div>
            <div className="space-y-1"><Label htmlFor="full-edit-phone">Contact (Phone Number)</Label><Input id="full-edit-phone" value={editForm.phone} inputMode="tel" onChange={(event) => setEditForm((current) => ({ ...current, phone: event.target.value }))} /></div>
            <div className="space-y-1"><Label htmlFor="full-edit-email">Email</Label><Input id="full-edit-email" value={editForm.email} onChange={(event) => setEditForm((current) => ({ ...current, email: event.target.value }))} /></div>
            <div className="space-y-1"><Label htmlFor="full-edit-gender">Gender</Label><Input id="full-edit-gender" value={editForm.gender} onChange={(event) => setEditForm((current) => ({ ...current, gender: event.target.value }))} /></div>
            <div className="space-y-1"><Label htmlFor="full-edit-insurance">Insurance Status</Label><Input id="full-edit-insurance" value={editForm.insurance_status} onChange={(event) => setEditForm((current) => ({ ...current, insurance_status: event.target.value }))} /></div>
            <div className="space-y-1"><Label htmlFor="full-edit-city">City / Area</Label><Input id="full-edit-city" value={editForm.city} onChange={(event) => setEditForm((current) => ({ ...current, city: event.target.value }))} /></div>
            <div className="space-y-1"><Label htmlFor="full-edit-disease">Treatment / Disease</Label><Input id="full-edit-disease" value={editForm.disease} onChange={(event) => setEditForm((current) => ({ ...current, disease: event.target.value }))} /></div>
            <div className="space-y-1"><Label htmlFor="full-edit-date">Lead Date</Label><Input id="full-edit-date" type="date" value={editForm.lead_date} onChange={(event) => setEditForm((current) => ({ ...current, lead_date: event.target.value }))} /></div>
            <div className="space-y-1"><Label htmlFor="full-edit-followup">Next Follow-Up Date</Label><Input id="full-edit-followup" type="date" value={editForm.follow_up_date} onChange={(event) => setEditForm((current) => ({ ...current, follow_up_date: event.target.value }))} /></div>
            <div className="space-y-1"><Label htmlFor="full-edit-assigned">Assigned To</Label>
              <Select value={editForm.assigned_to || "unassigned"} onValueChange={(value) => setEditForm((current) => ({ ...current, assigned_to: value === "unassigned" ? "" : String(value ?? "") }))}>
                <SelectTrigger id="full-edit-assigned" disabled={!canEditCore}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {employees.map((employee) => <SelectItem key={employee.id} value={employee.name}>{employee.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {canEditCore && editForm.assigned_to && editForm.assigned_to !== (editingLead?.assigned_to && editingLead.assigned_to !== "-" ? editingLead.assigned_to : "") && <div className="sm:col-span-2"><TransferDispositionChoices value={editTransferAsFresh ? "fresh" : "keep"} onChange={(value) => setEditTransferAsFresh(value === "fresh")} disabled={isSavingEdit} idPrefix="edit-transfer-disposition" /></div>}
            <div className="space-y-1"><Label htmlFor="full-edit-source">Source</Label>
              <Select value={editForm.source || "Manual"} onValueChange={(value) => setEditForm((current) => ({ ...current, source: String(value ?? "") }))}>
                <SelectTrigger id="full-edit-source" disabled={!canEditCore}><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72 overflow-y-auto">{[...new Set([...masterSourceOptions, editForm.source].filter(Boolean))].map((source) => <SelectItem key={source} value={source}>{source}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label htmlFor="full-edit-status">Status</Label>
              <Select value={canonicalLeadStatus(editForm.status)} onValueChange={(value) => setEditForm((current) => ({ ...current, status: String(value ?? "") }))}>
                <SelectTrigger id="full-edit-status"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72 overflow-y-auto">{statuses.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2 space-y-1"><Label htmlFor="full-edit-remarks">Remarks</Label><Textarea id="full-edit-remarks" rows={3} value={editForm.remarks} onChange={(event) => setEditForm((current) => ({ ...current, remarks: event.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditingLead(null)}>Cancel</Button>
            <Button type="button" disabled={isSavingEdit || !editForm.name.trim()} onClick={() => void handleSaveEdit()}>{isSavingEdit ? "Saving..." : "Save Changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(quickNoteLead)} onOpenChange={(open) => !open && setQuickNoteLead(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add quick note</DialogTitle><DialogDescription>Add a note to {quickNoteLead?.name}&apos;s remarks and timeline.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="quick-lead-note">Note</Label>
            <Textarea id="quick-lead-note" value={quickNote} onChange={(event) => setQuickNote(event.target.value)} placeholder="Write a short note..." rows={4} />
          </div>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setQuickNoteLead(null)}>Cancel</Button><Button type="button" disabled={isSavingQuickNote || !quickNote.trim()} onClick={handleQuickNote}>{isSavingQuickNote ? "Saving..." : "Save Note"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={Boolean(selectedLead)} onOpenChange={(open) => !open && setSelectedLead(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
          {selectedLead && <>
            <SheetHeader className="border-b border-slate-200 pr-12"><div className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">{getInitials(selectedLead.name)}</span><div><SheetTitle>{selectedLead.name}</SheetTitle><SheetDescription>Lead details and activity timeline</SheetDescription></div></div></SheetHeader>
            <div className="space-y-6 p-4">
              <section className="grid gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm sm:grid-cols-2">
                <div className="flex items-center gap-2 text-slate-600"><UserRound className="size-4" aria-hidden="true" />{selectedLead.email}</div>
                <div><p className="text-xs font-medium uppercase tracking-wide text-slate-400">Phone</p><p className="mt-1 text-slate-700">{selectedLead.phone}</p></div>
                <div><p className="text-xs font-medium uppercase tracking-wide text-slate-400">Gender</p><p className="mt-1 text-slate-700">{selectedLead.gender}</p></div>
                <div className="space-y-1"><Label htmlFor="edit-city">City</Label><Input id="edit-city" value={leadEdits.city} onChange={(event) => setLeadEdits((current) => ({ ...current, city: event.target.value }))} placeholder="-" /></div>
                <div className="space-y-1 sm:col-span-2"><Label htmlFor="edit-disease">Treatment / Disease</Label><Textarea id="edit-disease" rows={4} className="max-h-64 resize-y whitespace-pre-wrap [overflow-wrap:anywhere]" value={leadEdits.disease} onChange={(event) => setLeadEdits((current) => ({ ...current, disease: event.target.value }))} placeholder="-" /></div>
                <div className="space-y-1"><Label htmlFor="edit-insurance">Insurance Status</Label><Input id="edit-insurance" value={leadEdits.insurance_status} onChange={(event) => setLeadEdits((current) => ({ ...current, insurance_status: event.target.value }))} placeholder="-" /></div>
                <div className="sm:col-span-2 space-y-1"><Label htmlFor="edit-remarks">Remarks</Label><Textarea id="edit-remarks" rows={3} value={leadEdits.remarks} onChange={(event) => setLeadEdits((current) => ({ ...current, remarks: event.target.value }))} placeholder="-" /></div>
                <div className="flex items-center gap-2 sm:col-span-2">
                  <Button type="button" size="sm" onClick={() => void handleSaveLeadEdits()} disabled={isSavingEdits}>
                    {isSavingEdits ? "Saving..." : "Save Changes"}
                  </Button>
                  <span className="text-xs text-slate-400">Patient details and remarks can be edited on your assigned leads.</span>
                </div>
                <div className="flex gap-2 text-xs sm:col-span-2"><span className="rounded-full bg-white px-2.5 py-1 text-slate-600 ring-1 ring-slate-200">{selectedLead.status}</span></div>
                <div className="sm:col-span-2"><Label htmlFor="drawer-follow-up-date">Next Follow-Up Date</Label><Input id="drawer-follow-up-date" type="date" className="w-full cursor-pointer" disabled={savingLeadIds.has(selectedLead.id)} onClick={(event) => event.currentTarget.showPicker?.()} value={toInputDateValue(selectedLead.follow_up_date)} onChange={(event) => void handleFollowUpChange(selectedLead, event.target.value)} /></div>
              </section>
              <section><h3 className="mb-3 text-sm font-semibold text-slate-900">Activity timeline</h3>{isLoadingActivities ? <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" aria-hidden="true" />Loading activity...</div> : activities.length === 0 ? <p className="text-sm text-slate-500">No activity yet.</p> : <div className="space-y-4 border-l border-slate-200 pl-4">{activities.map((activity) => <article key={activity.id} className="relative space-y-1"><span className="absolute -left-[1.3rem] top-1 size-2 rounded-full bg-slate-400 ring-4 ring-white" /><p className="text-xs font-medium uppercase tracking-wide text-slate-400">{activity.action_type} · {formatDate(activity.created_at)}</p><p className="text-sm text-slate-700">{activity.description || "No details provided."}</p></article>)}</div>}</section>
              <section className="space-y-3 border-t border-slate-200 pt-5"><Label htmlFor="lead-note">Add note</Label><Textarea id="lead-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Write a note about this lead..." rows={4} /><Button type="button" onClick={handleAddNote} disabled={isAddingNote || !note.trim()}>{isAddingNote ? "Adding note..." : "Add Note"}</Button></section>
            </div>
          </>}
        </SheetContent>
      </Sheet>
    </>
  );
}
