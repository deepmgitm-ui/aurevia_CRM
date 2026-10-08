"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { CalendarDays, ChevronLeft, ChevronRight, ClipboardPaste, Dices, Download, FileUp, Loader2, MessageCircle, Pencil, Phone, Plus, RotateCcw, Search, SearchX, Trash2, UserRound, UserRoundPlus, X } from "lucide-react";

import {
  addLeadActivity,
  bulkDeleteLeads,
  bulkInsertLeads,
  createLead,
  getEmployees,
  getLeadActivities,
  getLeadDeletionBackups,
  getLeadAssignmentPreview,
  getLeadSourceDeletePreview,
  permanentlyDeleteLeadDeletionBackup,
  restoreLeadDeletionBackup,
  getLeadsForExport,
  getLeadsPage,
  updateLeadDetails,
  updateLeadStatus,
  updateLeadAssignment,
  updateLeadTemperature,
  updateLeadFollowUpDate,
  updateLeadAppointment,
  randomAssignLeads,
  assignLeadsToEmployees,
  type LeadAssignmentCriteria,
  type LeadSourceDeletePreview,
  type Lead,
  type LeadActivity,
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

// Dropdown options (status / temperature / source) live in the DATABASE so an
// admin can edit them in Settings → Master Data without a deploy
// (supabase-master-data-migration.sql). `seedMasterData()` is the fallback: the
// selects render real options immediately, before the fetch resolves.

// Must match LEADS_PAGE_SIZE in app/actions/leads.ts ("use server" files can
// only export async functions, so the constant is duplicated here).
const LEADS_PAGE_SIZE = 50;

// "Magic Paste": Excel / Google Sheets copies land on the clipboard as
// Tab-Separated Values (TSV). Rows are split by newlines and columns by tabs;
// the first pasted row is treated as the header row and every cell is keyed by
// its header. That means the EXACT same flexible, case-insensitive column
// mapping used for CSV/Excel imports applies downstream in bulkInsertLeads
// (name/patient -> name, phone/contact -> contact, city/location/area ->
// city, treatment/disease -> treatment, remarks/notes -> remarks, ...), and
// unmapped/missing fields fall back to "-" automatically.
function parsePastedTable(text: string): ImportRow[] {
  const rows = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((row) => row.trim().length > 0);
  if (rows.length === 0) return [];

  const headers = rows[0].split("\t").map((header) => header.trim());
  const records: ImportRow[] = [];
  for (const row of rows.slice(1)) {
    const cells = row.split("\t");
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (!header) return;
      record[header] = (cells[index] ?? "").trim();
    });
    records.push(record as ImportRow);
  }
  return records;
}

// Canonical field aliases understood by the import pipeline (mirrors the
// flexible mapping inside bulkInsertLeads) — used to give paste-time feedback
// in the Magic Paste modal.
const PASTE_HEADER_ALIASES: { label: string; aliases: string[] }[] = [
  { label: "Name", aliases: ["full name", "name", "patient name", "patient_name", "patient"] },
  { label: "Phone", aliases: ["contact no", "phone", "phone number", "phone_number", "contact", "contact number", "mobile"] },
  { label: "City", aliases: ["city", "location", "area", "address"] },
  { label: "Disease", aliases: ["disease", "treatment", "issue", "problem", "health concern"] },
  { label: "Remarks", aliases: ["remark 1", "remarks", "remark", "note", "notes", "comment", "comments"] },
  { label: "Date", aliases: ["date", "lead date", "lead_date", "date of lead", "date_of_lead", "created at", "created_at"] },
  { label: "Email", aliases: ["email", "email id", "email_id", "mail"] },
];

// Reads just the first non-empty line's headers of the pasted TSV.
function getPastedHeaders(text: string): string[] {
  const firstLine = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .find((row) => row.trim().length > 0);
  if (!firstLine) return [];
  return firstLine
    .split("\t")
    .map((header) => header.trim())
    .filter(Boolean);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function getInitials(name: string): string {
  return name.split(" ").filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
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

const temperatureLabels: Record<string, string> = {
  Hot: "Hot 🔥",
  Warm: "Warm ☀️",
  Cold: "Cold ❄️",
};

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
function treatmentCellData(lead: Lead): { key: string; label: string; detail: string } {
  const resolved = resolveTreatmentText(lead as unknown as Record<string, unknown>) || lead.disease || "";
  const { key, label } = canonicalTreatment(resolved);
  const raw = (lead.disease ?? "").trim();
  const detail = raw && raw !== "-" && raw.toLowerCase() !== label.toLowerCase() ? raw : "";
  return { key, label, detail };
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
    Temperature: lead.temperature,
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

export function LeadsTable({
  leads: initialLeads,
  initialTotal,
  initialTotalPages,
  assignedTo = "",
  role = "employee",
  filters = EMPTY_LEAD_FILTERS,
}: {
  leads: Lead[];
  initialTotal: number;
  initialTotalPages: number;
  // When set (admin drill-down), all fetching and bulk actions are scoped to
  // this employee's leads only (server-side assigned_to filter).
  assignedTo?: string;
  // RBAC: employees cannot delete, bulk-import, see lead sources, or edit core
  // lead data (only Status/Temp/Remarks). Computed once per render.
  role?: ViewerRole;
  // Chart drill-down filters from the URL (?stage=&treatment=&age=&city=).
  // They travel with EVERY server call so paging/export stays filtered.
  filters?: LeadListFilters;
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
  const [backupPendingDeletion, setBackupPendingDeletion] = useState<LeadDeletionBackup | null>(null);
  const [deletingBackupId, setDeletingBackupId] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isAddLeadOpen, setIsAddLeadOpen] = useState(false);
  const [isCreatingLead, setIsCreatingLead] = useState(false);
  const [savingLeadIds, setSavingLeadIds] = useState<Set<string>>(() => new Set());
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [leadEdits, setLeadEdits] = useState({ city: "", disease: "", insurance_status: "", remarks: "" });
  const [isSavingEdits, setIsSavingEdits] = useState(false);
  // "Edit Lead" modal: allows editing ALL fields of a single lead.
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
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
    temperature: "",
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
    const normalizedHeaders = getPastedHeaders(pastedData).map((header) =>
      header.trim().toLowerCase().replace(/\s+/g, " "),
    );
    const recognized = PASTE_HEADER_ALIASES.filter((field) =>
      field.aliases.some((alias) => normalizedHeaders.includes(alias)),
    ).map((field) => field.label);
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
      (employee.role === "employee" || (isAdmin && employee.role !== "employee")),
  );
  // Master data (Settings → Master Data): the DB-backed picklists. Seeded first
  // so the selects are never empty, then upgraded with the admin's lists.
  const [masterData, setMasterData] = useState<MasterDataSnapshot>(() => seedMasterData());
  const [quickNoteLead, setQuickNoteLead] = useState<Lead | null>(null);
  const [quickNote, setQuickNote] = useState("");
  const [isSavingQuickNote, setIsSavingQuickNote] = useState(false);
  const [selectedLeads, setSelectedLeads] = useState<string[]>([]);
  const [isBulkActionPending, setIsBulkActionPending] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isAssignmentOpen, setIsAssignmentOpen] = useState(false);
  const [assignmentMode, setAssignmentMode] = useState<"selected" | "filters">("filters");
  const [assignmentEmployeeNames, setAssignmentEmployeeNames] = useState<string[]>([]);
  const [assignmentCriteria, setAssignmentCriteria] = useState<LeadAssignmentCriteria>({
    search: "",
    treatment: "",
    city: "",
  });
  const [assignmentPreviewCount, setAssignmentPreviewCount] = useState<number | null>(null);
  const [isPreviewingAssignment, setIsPreviewingAssignment] = useState(false);
  const [isSourceDeleteOpen, setIsSourceDeleteOpen] = useState(false);
  const [deleteSourceInput, setDeleteSourceInput] = useState("");
  const [sourceDeletePreview, setSourceDeletePreview] = useState<LeadSourceDeletePreview | null>(null);
  const [isPreviewingSourceDelete, setIsPreviewingSourceDelete] = useState(false);
  const [isDeletingSource, setIsDeletingSource] = useState(false);
  const [selectedSource, setSelectedSource] = useState("all");
  // Search/status seeded from the URL drill-down so paging and debounced typing
  // never drop the filter the admin arrived with.
  const [searchTerm, setSearchTerm] = useState(filters.q);
  // The search term currently applied on the SERVER. Search runs in Supabase
  // (.or / .ilike across ALL leads in the database), not against the 50 rows
  // loaded on the current page.
  const [activeSearch, setActiveSearch] = useState(filters.q);
  const [selectedTemperature, setSelectedTemperature] = useState("all");
  // Advanced status filter (server-side): "" = all; Hot/Warm/Cold target the
  // temperature column, everything else targets the status column.
  const [selectedStatus, setSelectedStatus] = useState(filters.status || "all");
  const [activeStatusFilter, setActiveStatusFilter] = useState(filters.status);
  const [isExporting, setIsExporting] = useState(false);
  const [dateField, setDateField] = useState<DateFilterField>("lead_date");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [isDatePopoverOpen, setIsDatePopoverOpen] = useState(false);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Guards against out-of-order responses when searches/pages change quickly —
  // only the most recently issued fetch is allowed to update the table.
  const fetchSequenceRef = useRef(0);

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
  const statuses = masterData.lists.statuses;
  const temperatures = masterData.lists.temperatures;
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
    selectedTemperature !== "all" ||
    dateFilter !== null;

  function resetFilters() {
    setSearchTerm("");
    setSelectedStatus("all");
    setSelectedSource("all");
    setSelectedTemperature("all");
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

  // Chained layers: Search (server-side) -> Source -> Temperature -> Date range (Lead Date ya Follow-Up Date pe) -> Sorting
  // Memoized: filtering only reruns when the page data or one of the filters
  // actually changes (not on every keystroke-driven re-render).
  const filteredLeads = useMemo(() => leads.filter((lead) => {
    // NOTE: search is applied SERVER-SIDE via activeSearch, so it matches leads
    // on every page of the database. Only these remaining filters run on the
    // rows currently loaded in the table.
    if (selectedSource !== "all" && lead.source !== selectedSource) return false;

    if (selectedTemperature !== "all" && lead.temperature !== selectedTemperature) return false;

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
  }), [leads, selectedSource, selectedTemperature, dateFilter]);

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
      label: `Status: ${temperatureLabels[activeStatusFilter] ?? activeStatusFilter}`,
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
  if (selectedTemperature !== "all") {
    activeFilterChips.push({
      key: "temp",
      label: `Temp: ${temperatureLabels[selectedTemperature] ?? selectedTemperature}`,
      onRemove: () => setSelectedTemperature("all"),
    });
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
  // status/temperature filter ("" = no filter).
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

  async function processImportedRows(parsedData: ImportRow[], fileName: string) {
    try {
      const plainData = JSON.parse(JSON.stringify(parsedData));
      const response = await bulkInsertLeads(plainData, fileName);
      if (!response.success) {
        toast.add({ title: "Import failed", description: response.error, type: "error" });
        return;
      }

      const { leads: importedLeads, skippedDuplicates, skippedRows, unassigned } = response.data;
      // Mark imported rows as self-mutations so realtime notifications don't
      // toast the admin about their own bulk import.
      trackLeadMutations(importedLeads.map((lead) => lead.id));
      setLeads((previousLeads) => [...importedLeads, ...previousLeads]);
      setServerTotal((current) => current + importedLeads.length);

      // The toast used to be the only proof the upload worked. When a filter (or
      // an unassigned sheet) hid the rows, it looked like the import had
      // vanished — so now the server itself is asked what it holds, and any
      // reason the rows might not be visible is spelled out.
      const proof = await getLeadsPage(1, 1, "", "", "", {});
      const serverTotal = proof.success ? proof.data.total : null;
      const filtersAreActive = Boolean(hasLeadFilters(filters) || activeSearch.trim() || activeStatusFilter.trim());

      toast.add({
        title: "Import complete",
        description:
          importedLeads.length === 0
            ? `No new leads were added — all ${skippedDuplicates} phone numbers already exist in the database.${skippedRows > 0 ? ` ${skippedRows} invalid rows were also skipped.` : ""}`
            : `${importedLeads.length} leads imported successfully.${serverTotal !== null ? ` The database now holds ${serverTotal.toLocaleString()} lead${serverTotal === 1 ? "" : "s"}.` : ""}${skippedDuplicates > 0 ? ` ${skippedDuplicates} duplicate${skippedDuplicates === 1 ? "" : "s"} skipped (phone number already exists).` : ""}${skippedRows > 0 ? ` ${skippedRows} invalid rows skipped.` : ""}`,
        type: "success",
      });

      if (importedLeads.length > 0 && filtersAreActive) {
        toast.add({
          title: "Some imported leads are hidden by your filters",
          description:
            "This list is filtered, so leads that do not match the active search / status / chart filters are not shown. Clear the filters to see every lead you just added.",
          type: "error",
        });
      }

      if (unassigned > 0) {
        toast.add({
          title: `${unassigned} imported lead${unassigned === 1 ? " has" : "s have"} no agent`,
          description:
            "Their spreadsheet had no matching \"Assigned To\" name, so they were saved as unassigned (\"-\"). Employees only see leads assigned to them — assign these from the table (tick the rows → Assign) so they reach the team.",
          type: "error",
        });
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
      Papa.parse<ImportRow>(file, {
        header: true,
        skipEmptyLines: true,
        complete: (result) => {
          if (result.errors.length > 0) {
            setIsImporting(false);
            toast.add({ title: "Import could not be read", description: result.errors[0].message, type: "error" });
            return;
          }
          void processImportedRows(result.data, file.name);
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
      reader.onload = (event) => {
        try {
          const buffer = event.target?.result;
          if (!(buffer instanceof ArrayBuffer)) {
            throw new Error("Unable to read the Excel file.");
          }

          const workbook = XLSX.read(buffer, { type: "array" });
          const firstSheetName = workbook.SheetNames[0];
          if (!firstSheetName) {
            throw new Error("The Excel file does not contain a worksheet.");
          }

          const worksheet = workbook.Sheets[firstSheetName];
          const rows = XLSX.utils.sheet_to_json<ImportRow>(worksheet, { defval: "" });
          void processImportedRows(rows, file.name);
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
        title: "Nothing to add",
        description: "Paste your Excel or Google Sheets data first (the first row must be the header row).",
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
      temperature: String(formData.get("temperature") ?? "Warm"),
      status: String(formData.get("status") ?? "New"),
    });
    if (!response.success) {
      toast.add({ title: "Unable to add lead", description: response.error, type: "error" });
    } else {
      trackLeadMutations(response.data.id);
      setLeads((currentLeads) => [response.data, ...currentLeads]);
      setServerTotal((current) => current + 1);
      setIsAddLeadOpen(false);
      form.reset();
      toast.add({ title: "Lead added", description: `${response.data.name} was added to your pipeline.`, type: "success" });
    }
    setIsCreatingLead(false);
  }

  async function handleStatusChange(lead: Lead, status: string | null) {
    if (!status || status === lead.status || savingLeadIds.has(lead.id)) return;
    trackLeadMutations(lead.id);
    setLeadSaving(lead.id, true);
    patchLeadLocally(lead.id, { status });
    const response = await updateLeadStatus({ id: lead.id, status, temperature: lead.temperature });
    if (!response.success) {
      updateLeadLocally(lead);
      toast.add({ title: "Status update failed", description: response.error, type: "error" });
    } else {
      updateLeadLocally(response.data);
      toast.add({ title: "Status saved", type: "success" });
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
    const fieldLabel = field.label;

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
      toast.add({ title: `${fieldLabel} saved`, type: "success" });
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
    trackLeadMutations(lead.id);
    setLeadSaving(lead.id, true);
    patchLeadLocally(lead.id, { assigned_to: employeeName });
    const response = await updateLeadAssignment(lead.id, employeeName);
    if (!response.success) {
      updateLeadLocally(lead);
      toast.add({ title: "Assignment update failed", description: response.error, type: "error" });
    } else {
      updateLeadLocally(response.data);
      toast.add({ title: "Assignment saved", type: "success" });
    }
    setLeadSaving(lead.id, false);
  }

  async function handleTemperatureChange(lead: Lead, temperature: string | null) {
    if (!temperature || temperature === lead.temperature || savingLeadIds.has(lead.id)) return;
    trackLeadMutations(lead.id);
    setLeadSaving(lead.id, true);
    patchLeadLocally(lead.id, { temperature });
    const response = await updateLeadTemperature(lead.id, temperature);
    if (!response.success) {
      updateLeadLocally(lead);
      toast.add({ title: "Temperature update failed", description: response.error, type: "error" });
    } else {
      updateLeadLocally(response.data);
      toast.add({ title: "Temperature saved", type: "success" });
    }
    setLeadSaving(lead.id, false);
  }

  function toggleLeadSelection(leadId: string, selected: boolean) {
    setSelectedLeads((current) => selected ? [...new Set([...current, leadId])] : current.filter((id) => id !== leadId));
    // Individually deselecting a lead cancels the "select all" (delete-all) mode.
    if (!selected) setIsSelectAllChecked(false);
  }

  async function handleAssignSelected(employeeName: string | null) {
    if (!employeeName || employeeName === "-") return;
    setIsBulkActionPending(true);
    const results = await Promise.all(selectedLeads.map((leadId) => updateLeadAssignment(leadId, employeeName)));
    const failed = results.find((result) => !result.success);
    if (failed && !failed.success) {
      toast.add({ title: "Assignment failed", description: failed.error, type: "error" });
    } else {
      setLeads((current) => current.map((lead) => selectedLeads.includes(lead.id) ? { ...lead, assigned_to: employeeName } : lead));
      setSelectedLeads([]);
      setIsSelectAllChecked(false);
      toast.add({ title: "Leads assigned", description: `${selectedLeads.length} leads assigned successfully.`, type: "success" });
    }
    setIsBulkActionPending(false);
  }

  async function handleRandomAssign() {
    setIsBulkActionPending(true);
    const response = await randomAssignLeads(selectedLeads);
    if (!response.success) {
      toast.add({ title: "Distribution failed", description: response.error, type: "error" });
    } else {
      setSelectedLeads([]);
      setIsSelectAllChecked(false);
      router.refresh();
      toast.add({ title: "Distribution complete", description: `${response.data.assigned} leads distributed equally.`, type: "success" });
    }
    setIsBulkActionPending(false);
  }

  function openAssignment(mode: "selected" | "filters") {
    setAssignmentMode(mode);
    setAssignmentEmployeeNames([]);
    setAssignmentCriteria({ search: "", treatment: "", city: "" });
    setAssignmentPreviewCount(null);
    setIsAssignmentOpen(true);
  }

  function toggleAssignmentEmployee(name: string, checked: boolean) {
    setAssignmentEmployeeNames((current) =>
      checked ? [...new Set([...current, name])] : current.filter((entry) => entry !== name),
    );
  }

  function updateAssignmentCriteria(patch: Partial<LeadAssignmentCriteria>) {
    setAssignmentCriteria((current) => ({ ...current, ...patch }));
    setAssignmentPreviewCount(null);
  }

  async function previewFilteredAssignment() {
    setIsPreviewingAssignment(true);
    try {
      const response = await getLeadAssignmentPreview(assignmentCriteria);
      if (!response.success) {
        setAssignmentPreviewCount(null);
        toast.add({ title: "Could not find matching leads", description: response.error, type: "error" });
      } else {
        setAssignmentPreviewCount(response.data.count);
      }
    } catch (error) {
      setAssignmentPreviewCount(null);
      toast.add({
        title: "Could not find matching leads",
        description: error instanceof Error ? error.message : "Unable to reach the server. Please try again.",
        type: "error",
      });
    } finally {
      setIsPreviewingAssignment(false);
    }
  }

  async function handleAssignAmongSelectedEmployees() {
    if (assignmentEmployeeNames.length === 0 || isBulkActionPending) return;
    setIsBulkActionPending(true);
    try {
      const response = await assignLeadsToEmployees(
        assignmentMode === "selected"
          ? { leadIds: selectedLeads, employeeNames: assignmentEmployeeNames }
          : { criteria: assignmentCriteria, employeeNames: assignmentEmployeeNames },
      );
      if (!response.success) {
        toast.add({ title: "Assignment failed", description: response.error, type: "error" });
      } else {
        if (assignmentMode === "selected") {
          setSelectedLeads([]);
          setIsSelectAllChecked(false);
        }
        setIsAssignmentOpen(false);
        router.refresh();
        toast.add({
          title: `${response.data.assigned.toLocaleString()} leads assigned`,
          description: response.data.perEmployee.map((entry) => `${entry.name}: ${entry.count}`).join(" · "),
          type: "success",
        });
      }
    } catch (error) {
      toast.add({
        title: "Assignment failed",
        description: error instanceof Error ? error.message : "Unable to reach the server. Please try again.",
        type: "error",
      });
    } finally {
      setIsBulkActionPending(false);
    }
  }

  async function previewSourceDeletion() {
    setIsPreviewingSourceDelete(true);
    setSourceDeletePreview(null);
    try {
      const response = await getLeadSourceDeletePreview(deleteSourceInput);
      if (!response.success) {
        toast.add({ title: "Could not preview source", description: response.error, type: "error" });
      } else {
        setSourceDeletePreview(response.data);
      }
    } catch (error) {
      toast.add({
        title: "Could not preview source",
        description: error instanceof Error ? error.message : "Unable to reach the server. Please try again.",
        type: "error",
      });
    } finally {
      setIsPreviewingSourceDelete(false);
    }
  }

  async function handleDeleteSource() {
    if (!sourceDeletePreview || sourceDeletePreview.count === 0 || isDeletingSource) return;
    setIsDeletingSource(true);
    try {
      const backup = await getLeadsForExport("", "", "", { source: sourceDeletePreview.source });
      if (!backup.success) {
        toast.add({
          title: "Source deletion cancelled",
          description: `A CSV safety copy could not be prepared. ${backup.error}`,
          type: "error",
        });
        return;
      }
      downloadLeadsCsv(
        backup.data,
        `leads-source-backup-${sourceDeletePreview.source.replace(/[^a-z0-9]+/gi, "-")}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`,
      );
      const response = await bulkDeleteLeads([], true, "", "", "", sourceDeletePreview.source);
      if (!response.success) {
        toast.add({ title: "Source deletion failed", description: response.error, type: "error" });
        return;
      }
      setIsSourceDeleteOpen(false);
      setDeleteSourceInput("");
      setSourceDeletePreview(null);
      router.refresh();
      toast.add({
        title: "Source leads deleted",
        description: `${response.data.deleted.toLocaleString()} leads with source "${sourceDeletePreview.source}" were deleted. A CSV and recovery snapshot were saved.`,
        type: "success",
      });
    } catch (error) {
      toast.add({
        title: "Source deletion failed",
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
      downloadLeadsCsv(backup.data, `leads-backup-before-delete-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`);
    } else if (requiresTypedConfirm) {
      // Wiping EVERY lead with no copy anywhere = data loss we cannot undo.
      toast.add({
        title: "Delete cancelled — no backup could be saved",
        description: `${backup.error} Deleting every lead without a saved copy is not allowed; export the CSV first (admin) or run supabase-deletion-backup-migration.sql.`,
        type: "error",
      });
      setIsBulkActionPending(false);
      return;
    } else {
      toast.add({
        title: "No backup file saved",
        description: `${backup.error} Continuing — the database snapshot is the only way back.`,
        type: "error",
      });
    }
    const response = await bulkDeleteLeads(
      deleteAll ? [] : selectedLeads,
      deleteAll,
      activeSearch,
      assignedTo,
      deleteConfirmText,
      "",
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
      toast.add({ title: "Note added", description: "The lead remarks were updated.", type: "success" });
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
      toast.add({ title: "Lead updated", description: "The lead details were saved.", type: "success" });
    }
    setIsSavingEdits(false);
  }

  function handleEditLead(lead: Lead) {
    setEditingLead(lead);
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
      status: lead.status ?? "",
      temperature: lead.temperature ?? "",
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
    // RBAC: employees can only save Status / Temp / Remarks; core fields are
    // read-only for them (also enforced server-side in updateLeadDetails).
    const payload = canEditCore
      ? { id: editingLead.id, ...editForm }
      : {
          id: editingLead.id,
          status: editForm.status,
          temperature: editForm.temperature,
          remarks: editForm.remarks,
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
          status: editForm.status,
          temperature: editForm.temperature,
          remarks: editForm.remarks || "-",
        };
    updateLeadLocally(optimisticLead);
    const response = await updateLeadDetails(payload);
    if (!response.success) {
      updateLeadLocally(editingLead);
      toast.add({ title: "Unable to save changes", description: response.error, type: "error" });
    } else {
      const updated = response.data;
      // Smooth refresh: swap the saved row into the table state — no page reload.
      updateLeadLocally(updated);
      setEditingLead(null);
      toast.add({ title: "Lead updated", description: `${updated.name}'s details were saved.`, type: "success" });
      // Keep the server-rendered stat cards (New/Hot counts) in sync.
      router.refresh();
    }
    setIsSavingEdit(false);
  }

  async function handleAddNote() {
    if (!selectedLead || !note.trim()) return;
    setIsAddingNote(true);
    const response = await addLeadActivity({ lead_id: selectedLead.id, action_type: "Note", description: note.trim() });
    if (!response.success) {
      toast.add({ title: "Unable to add note", description: response.error, type: "error" });
    } else {
      setActivities((currentActivities) => [response.data, ...currentActivities]);
      setNote("");
      toast.add({ title: "Note added", description: "The lead timeline was updated.", type: "success" });
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
      toast.add({ title: "Follow-up saved", type: "success" });
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
              <Button type="button" variant="outline" onClick={() => openAssignment("filters")}>
                <UserRoundPlus aria-hidden="true" />
                Assign by Filters
              </Button>
            )}
            {isAdmin && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setDeleteSourceInput("");
                  setSourceDeletePreview(null);
                  setIsSourceDeleteOpen(true);
                }}
              >
                <Trash2 aria-hidden="true" />
                Delete by Source
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
                  {["Hot", "Warm", "Cold", ...statuses].map((option) => (
                    <SelectItem key={option} value={option}>{temperatureLabels[option] ?? option}</SelectItem>
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

              <Select value={selectedTemperature} onValueChange={(value) => setSelectedTemperature(typeof value === "string" ? value : "all")}>
                <SelectTrigger className="w-32" aria-label="Filter by temperature"><SelectValue placeholder="All Temps" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Temps</SelectItem>
                  <SelectItem value="Hot">Hot 🔥</SelectItem>
                  <SelectItem value="Warm">Warm ☀️</SelectItem>
                  <SelectItem value="Cold">Cold ❄️</SelectItem>
                </SelectContent>
              </Select>

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
            <Button type="button" variant="outline" size="sm" disabled={isBulkActionPending} onClick={() => openAssignment("selected")}>
              <UserRoundPlus aria-hidden="true" />Split among employees
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={isBulkActionPending} onClick={() => void handleRandomAssign()}><Dices aria-hidden="true" />Distribute Equally</Button>
            <Button type="button" variant="destructive" size="sm" disabled={isBulkActionPending} onClick={() => setIsDeleteConfirmOpen(true)}><Trash2 aria-hidden="true" />Delete Selected</Button>
          </div>
        )}
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              {canDelete && <TableHead className="w-10"><input type="checkbox" aria-label="Select all leads" checked={isSelectAllChecked} onChange={(event) => { const checked = event.target.checked; setIsSelectAllChecked(checked); setSelectedLeads(checked ? [...new Set([...selectedLeads, ...sortedLeads.map((lead) => lead.id)])] : selectedLeads.filter((id) => !sortedLeads.some((lead) => lead.id === id))); }} /></TableHead>}
              <SortableTableHead className="w-[250px]" label="Patient" sortKey="name" sortConfig={sortConfig} onSort={toggleSort} />
              <TableHead className="w-[150px]">Contact</TableHead>
              <SortableTableHead className="w-[130px]" label="Lead Date" sortKey="lead_date" sortConfig={sortConfig} onSort={toggleSort} />
              <TableHead className="w-[140px]">City</TableHead>
              <TableHead className="w-[150px]">Treatment</TableHead>
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
                            {"Deleted leads by mistake? Re-import the CSV that every delete downloads automatically (leads-backup-before-delete-*.csv), or restore an admin snapshot from \"Recent Deletions\"."}
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
                const ageLabel = relativeLeadAge(lead.lead_date);
                const treatment = treatmentCellData(lead);
                return (
                <TableRow key={lead.id} className={isNew ? "bg-emerald-50/50" : undefined}>
                  {canDelete && <TableCell className="w-10 py-3"><input type="checkbox" aria-label={`Select ${lead.name}`} checked={selectedLeads.includes(lead.id)} onChange={(event) => toggleLeadSelection(lead.id, event.target.checked)} /></TableCell>}
                  <TableCell className="w-[250px] max-w-[250px] py-3"><div className="flex items-center gap-1.5"><button type="button" className="min-w-0 flex-1 truncate text-left font-semibold text-slate-900 hover:underline" onClick={() => handleViewLead(lead)}>{lead.name}</button>{isNew && (<Badge className="shrink-0 border-emerald-200 bg-emerald-100 text-emerald-800">NEW</Badge>)}<button type="button" aria-label={`Edit ${lead.name}`} title="Edit lead" className="shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700" onClick={() => handleEditLead(lead)}><Pencil className="size-3.5" aria-hidden="true" /></button></div><p className="max-w-full break-words whitespace-normal text-xs text-muted-foreground">{lead.email}</p>{canSeeSource && <Badge className={`mt-1 ${sourceBadgeClass(lead.source)}`}>{lead.source}</Badge>}</TableCell>
                  <TableCell className="min-w-[130px]">
                    <div className="flex flex-col items-start gap-1.5">
                      <span className="font-medium">{lead.phone}</span>
                      <div className="flex items-center gap-1">
                        <a
                          href={`tel:${(lead.phone ?? "").replace(/\D/g, "")}`}
                          aria-label={`Call ${lead.name}`}
                          title="Call"
                          className="inline-flex items-center rounded-md border border-slate-200 bg-white px-1.5 py-1 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
                        >
                          <Phone className="size-3" aria-hidden="true" />
                        </a>
                        <a
                          href={`https://wa.me/91${(lead.phone ?? "").replace(/\D/g, "")}`}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`WhatsApp ${lead.name}`}
                          title="WhatsApp"
                          className="inline-flex items-center rounded-md border border-green-300 bg-green-50 px-1.5 py-1 text-green-700 transition-colors hover:bg-green-100"
                        >
                          <MessageCircle className="size-3" aria-hidden="true" />
                        </a>
                      </div>
                    </div>
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
                  <TableCell className="w-[150px] max-w-[150px] py-3">
                    <div className="flex items-start gap-1.5" title={treatment.detail || treatment.label}>
                      <span
                        className="mt-1 size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: treatmentColor(treatment.key) }}
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800">{treatment.label}</p>
                        {treatment.detail && (
                          <p className="break-words whitespace-normal text-[11px] text-slate-500">
                            {treatment.detail}
                          </p>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="w-[180px] py-3">
                    <div className="space-y-1.5">
                      <Select value={lead.status} onValueChange={(value) => handleStatusChange(lead, value)} disabled={savingLeadIds.has(lead.id)}>
                        <SelectTrigger size="sm" aria-label={`Status for ${lead.name}`} className="w-full max-w-[170px]"><SelectValue /></SelectTrigger>
                        <SelectContent className="max-h-72 overflow-y-auto">{[...new Set([...statuses, lead.status])].map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent>
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
                  <TableCell className="w-[180px] py-3"><Select value={lead.temperature} onValueChange={(value) => handleTemperatureChange(lead, value)} disabled={savingLeadIds.has(lead.id)}>
                    <SelectTrigger size="sm" className="w-full max-w-[170px]"><SelectValue /></SelectTrigger>
                    <SelectContent>{temperatures.map((temperature) => <SelectItem key={temperature} value={temperature}>{temperature === "Hot" ? "Hot 🔥" : temperature === "Warm" ? "Warm ☀️" : "Cold ❄️"}</SelectItem>)}</SelectContent>
                  </Select></TableCell>
                  <TableCell className="w-[180px] py-3"><Select value={lead.assigned_to} onValueChange={(value) => handleAssignmentChange(lead, value)} disabled={savingLeadIds.has(lead.id)}>
                    <SelectTrigger size="sm" className="w-full max-w-[170px]"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                    <SelectContent><SelectItem value="-">Unassigned</SelectItem>{employees.map((employee) => <SelectItem key={employee.id} value={employee.name}>{employee.name}</SelectItem>)}</SelectContent>
                  </Select></TableCell>
                  <TableCell className="w-[250px] max-w-[250px] py-3"><div className="flex max-w-full items-start gap-2"><span className="line-clamp-2 min-w-0 break-words whitespace-normal text-xs text-slate-600" title={lead.remarks}>{lead.remarks}</span><Button type="button" variant="ghost" size="xs" className="shrink-0 whitespace-nowrap px-1.5" onClick={() => setQuickNoteLead(lead)}>✏️ Note</Button></div></TableCell>
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
              Rows are split by lines, columns by tabs. Missing columns and blank cells are filled automatically, invalid dates fall back to today, and duplicate phone numbers are skipped.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
            <p className="font-medium">
              Headers needed (any order): Name, Phone, City, Disease, Remarks, Date. Copy your data with headers and paste below.
            </p>
            {pastePreview.rowCount > 0 && (
              <p className="mt-1">
                {pastePreview.recognized.length > 0
                  ? `Detected columns: ${pastePreview.recognized.join(", ")}.`
                  : "No recognized column headers found — check that your first pasted row contains headers like Name or Phone."}
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
            <div className="space-y-2"><Label htmlFor="lead-temperature">Temperature</Label><Select name="temperature" defaultValue="Warm"><SelectTrigger id="lead-temperature"><SelectValue /></SelectTrigger><SelectContent>{temperatures.map((temperature) => <SelectItem key={temperature} value={temperature}>{temperature === "Hot" ? "Hot 🔥" : temperature === "Warm" ? "Warm ☀️" : "Cold ❄️"}</SelectItem>)}</SelectContent></Select></div>
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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {assignmentMode === "selected" ? "Split selected leads among employees" : "Assign leads by filters"}
            </DialogTitle>
            <DialogDescription>
              {assignmentMode === "selected"
                ? `${selectedLeads.length.toLocaleString()} selected leads will be split equally among the employees you choose.`
                : "Search by lead name/phone/disease, treatment, or city. Matching leads are reassigned and split equally among the employees you choose."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {assignmentMode === "filters" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="assign-lead-search">Lead name, phone or disease</Label>
                  <Input
                    id="assign-lead-search"
                    value={assignmentCriteria.search}
                    placeholder="Search matching leads"
                    disabled={isPreviewingAssignment || isBulkActionPending}
                    onChange={(event) => updateAssignmentCriteria({ search: event.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="assign-treatment">Treatment / disease</Label>
                  <Input
                    id="assign-treatment"
                    value={assignmentCriteria.treatment}
                    placeholder="e.g. Cataract"
                    disabled={isPreviewingAssignment || isBulkActionPending}
                    onChange={(event) => updateAssignmentCriteria({ treatment: event.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="assign-city">City</Label>
                  <Input
                    id="assign-city"
                    value={assignmentCriteria.city}
                    placeholder="e.g. Delhi"
                    disabled={isPreviewingAssignment || isBulkActionPending}
                    onChange={(event) => updateAssignmentCriteria({ city: event.target.value })}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      isPreviewingAssignment ||
                      (!assignmentCriteria.search.trim() && !assignmentCriteria.treatment.trim() && !assignmentCriteria.city.trim())
                    }
                    onClick={() => void previewFilteredAssignment()}
                  >
                    {isPreviewingAssignment && <Loader2 className="animate-spin" aria-hidden="true" />}
                    Preview matches
                  </Button>
                  {assignmentPreviewCount !== null && (
                    <span className={`text-sm ${assignmentPreviewCount > 10000 ? "text-rose-700" : "text-slate-600"}`}>
                      {assignmentPreviewCount.toLocaleString()} matching leads
                      {assignmentPreviewCount > 10000 ? " — narrow your filters to 10,000 or fewer." : ""}
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Assign to team members</Label>
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
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={isBulkActionPending} onClick={() => setIsAssignmentOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                isBulkActionPending ||
                assignmentEmployeeNames.length === 0 ||
                (assignmentMode === "selected"
                  ? selectedLeads.length === 0
                  : assignmentPreviewCount === null || assignmentPreviewCount === 0 || assignmentPreviewCount > 10000)
              }
              onClick={() => void handleAssignAmongSelectedEmployees()}
            >
              {isBulkActionPending && <Loader2 className="animate-spin" aria-hidden="true" />}
              Assign equally
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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Delete leads by source</DialogTitle>
            <DialogDescription>
              Enter one exact source name to review the matching leads before deleting. The deletion also saves a CSV and a Recent Deletions recovery snapshot.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="delete-lead-source">Lead source</Label>
              <Input
                id="delete-lead-source"
                list="lead-source-options"
                value={deleteSourceInput}
                placeholder="e.g. Meta Ads"
                disabled={isDeletingSource || isPreviewingSourceDelete}
                onChange={(event) => {
                  setDeleteSourceInput(event.target.value);
                  setSourceDeletePreview(null);
                }}
              />
              <datalist id="lead-source-options">
                {masterSourceOptions.map((source) => <option key={source} value={source} />)}
              </datalist>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={!deleteSourceInput.trim() || isPreviewingSourceDelete || isDeletingSource}
              onClick={() => void previewSourceDeletion()}
            >
              {isPreviewingSourceDelete && <Loader2 className="animate-spin" aria-hidden="true" />}
              Preview source
            </Button>
            {sourceDeletePreview && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                <p className="font-semibold">
                  {sourceDeletePreview.count.toLocaleString()} leads have source “{sourceDeletePreview.source}”.
                </p>
                {sourceDeletePreview.count > 0 && (
                  <p className="mt-1 text-xs text-amber-900">
                    CRM records were added between{" "}
                    {sourceDeletePreview.firstAddedAt
                      ? new Date(sourceDeletePreview.firstAddedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
                      : "unknown"}{" "}
                    and{" "}
                    {sourceDeletePreview.lastAddedAt
                      ? new Date(sourceDeletePreview.lastAddedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
                      : "unknown"}{" "}
                    (IST).
                  </p>
                )}
                {sourceDeletePreview.count > 5000 && (
                  <p className="mt-2 text-xs font-medium text-rose-700">
                    This is over the 5,000-lead snapshot limit. Narrow the source batch before deleting.
                  </p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isDeletingSource} onClick={() => setIsSourceDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!sourceDeletePreview || sourceDeletePreview.count === 0 || sourceDeletePreview.count > 5000 || isDeletingSource}
              onClick={() => void handleDeleteSource()}
            >
              {isDeletingSource && <Loader2 className="animate-spin" aria-hidden="true" />}
              Delete {sourceDeletePreview?.count.toLocaleString() ?? 0} leads
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={isRestoreOpen} onOpenChange={setIsRestoreOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Recent Deletions</DialogTitle>
            <DialogDescription>
              Every bulk delete stores a snapshot of the leads and activities it removed. Restore one to put the rows back —
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
              No stored deletions yet. Snapshots appear here after the next bulk delete.
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
                      disabled={Boolean(backup.restored_at) || restoringBackupId === backup.id || deletingBackupId === backup.id}
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
                      disabled={restoringBackupId === backup.id || deletingBackupId === backup.id}
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



      <Dialog open={Boolean(editingLead)} onOpenChange={(open) => !open && setEditingLead(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit lead</DialogTitle>
            <DialogDescription>Modify any field for {editingLead?.name}. Changes save directly to the database.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label htmlFor="full-edit-name">Patient Name</Label><Input id="full-edit-name" value={editForm.name} disabled={!canEditCore} onChange={(event) => setEditForm((current) => ({ ...current, name: event.target.value }))} /></div>
            <div className="space-y-1"><Label htmlFor="full-edit-phone">Contact (Phone Number)</Label><Input id="full-edit-phone" value={editForm.phone} inputMode="tel" disabled={!canEditCore} onChange={(event) => setEditForm((current) => ({ ...current, phone: event.target.value }))} /></div>
            <div className="space-y-1"><Label htmlFor="full-edit-email">Email</Label><Input id="full-edit-email" value={editForm.email} disabled={!canEditCore} onChange={(event) => setEditForm((current) => ({ ...current, email: event.target.value }))} /></div>
            <div className="space-y-1"><Label htmlFor="full-edit-gender">Gender</Label><Input id="full-edit-gender" value={editForm.gender} disabled={!canEditCore} onChange={(event) => setEditForm((current) => ({ ...current, gender: event.target.value }))} /></div>
            <div className="space-y-1"><Label htmlFor="full-edit-insurance">Insurance Status</Label><Input id="full-edit-insurance" value={editForm.insurance_status} disabled={!canEditCore} onChange={(event) => setEditForm((current) => ({ ...current, insurance_status: event.target.value }))} /></div>
            <div className="space-y-1"><Label htmlFor="full-edit-city">City / Area</Label><Input id="full-edit-city" value={editForm.city} disabled={!canEditCore} onChange={(event) => setEditForm((current) => ({ ...current, city: event.target.value }))} /></div>
            <div className="space-y-1"><Label htmlFor="full-edit-disease">Treatment / Disease</Label><Input id="full-edit-disease" value={editForm.disease} disabled={!canEditCore} onChange={(event) => setEditForm((current) => ({ ...current, disease: event.target.value }))} /></div>
            <div className="space-y-1"><Label htmlFor="full-edit-date">Lead Date</Label><Input id="full-edit-date" type="date" value={editForm.lead_date} disabled={!canEditCore} onChange={(event) => setEditForm((current) => ({ ...current, lead_date: event.target.value }))} /></div>
            <div className="space-y-1"><Label htmlFor="full-edit-followup">Next Follow-Up Date</Label><Input id="full-edit-followup" type="date" value={editForm.follow_up_date} disabled={!canEditCore} onChange={(event) => setEditForm((current) => ({ ...current, follow_up_date: event.target.value }))} /></div>
            <div className="space-y-1"><Label htmlFor="full-edit-assigned">Assigned To</Label>
              <Select value={editForm.assigned_to || "unassigned"} onValueChange={(value) => setEditForm((current) => ({ ...current, assigned_to: value === "unassigned" ? "" : String(value ?? "") }))}>
                <SelectTrigger id="full-edit-assigned" disabled={!canEditCore}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {employees.map((employee) => <SelectItem key={employee.id} value={employee.name}>{employee.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label htmlFor="full-edit-source">Source</Label>
              <Select value={editForm.source || "Manual"} onValueChange={(value) => setEditForm((current) => ({ ...current, source: String(value ?? "") }))}>
                <SelectTrigger id="full-edit-source" disabled={!canEditCore}><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72 overflow-y-auto">{[...new Set([...masterSourceOptions, editForm.source].filter(Boolean))].map((source) => <SelectItem key={source} value={source}>{source}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label htmlFor="full-edit-status">Status</Label>
              <Select value={editForm.status} onValueChange={(value) => setEditForm((current) => ({ ...current, status: String(value ?? "") }))}>
                <SelectTrigger id="full-edit-status"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72 overflow-y-auto">{[...new Set([...statuses, editForm.status])].map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label htmlFor="full-edit-temp">Temp</Label>
              <Select value={editForm.temperature} onValueChange={(value) => setEditForm((current) => ({ ...current, temperature: String(value ?? "") }))}>
                <SelectTrigger id="full-edit-temp"><SelectValue /></SelectTrigger>
                <SelectContent>{temperatures.map((temperature) => <SelectItem key={temperature} value={temperature}>{temperatureLabels[temperature] ?? temperature}</SelectItem>)}</SelectContent>
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
                <div className="space-y-1"><Label htmlFor="edit-city">City</Label><Input id="edit-city" value={leadEdits.city} disabled={!canEditCore} onChange={(event) => setLeadEdits((current) => ({ ...current, city: event.target.value }))} placeholder="-" /></div>
                <div className="space-y-1"><Label htmlFor="edit-disease">Treatment / Disease</Label><Input id="edit-disease" value={leadEdits.disease} disabled={!canEditCore} onChange={(event) => setLeadEdits((current) => ({ ...current, disease: event.target.value }))} placeholder="-" /></div>
                <div className="space-y-1"><Label htmlFor="edit-insurance">Insurance Status</Label><Input id="edit-insurance" value={leadEdits.insurance_status} disabled={!canEditCore} onChange={(event) => setLeadEdits((current) => ({ ...current, insurance_status: event.target.value }))} placeholder="-" /></div>
                <div className="sm:col-span-2 space-y-1"><Label htmlFor="edit-remarks">Remarks</Label><Textarea id="edit-remarks" rows={3} value={leadEdits.remarks} onChange={(event) => setLeadEdits((current) => ({ ...current, remarks: event.target.value }))} placeholder="-" /></div>
                <div className="flex items-center gap-2 sm:col-span-2">
                  <Button type="button" size="sm" onClick={() => void handleSaveLeadEdits()} disabled={isSavingEdits}>
                    {isSavingEdits ? "Saving..." : "Save Changes"}
                  </Button>
                  <span className="text-xs text-slate-400">City, Treatment, Insurance and Remarks can be edited here.</span>
                </div>
                <div className="flex gap-2 text-xs sm:col-span-2"><span className="rounded-full bg-white px-2.5 py-1 text-slate-600 ring-1 ring-slate-200">{selectedLead.status}</span><span className="rounded-full bg-white px-2.5 py-1 text-slate-600 ring-1 ring-slate-200">{selectedLead.temperature}</span></div>
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
