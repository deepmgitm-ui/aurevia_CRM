"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { CalendarDays, ChevronLeft, ChevronRight, ClipboardPaste, Dices, Download, FileUp, Loader2, MessageCircle, Pencil, Phone, Plus, RotateCcw, Search, Trash2, UserRound, X } from "lucide-react";

import {
  addLeadActivity,
  bulkDeleteLeads,
  bulkInsertLeads,
  createLead,
  getEmployees,
  getLeadActivities,
  getLeadsForExport,
  getLeadsPage,
  updateLeadDetails,
  updateLeadStatus,
  updateLeadAssignment,
  updateLeadTemperature,
  updateLeadFollowUpDate,
  randomAssignLeads,
  type Lead,
  type LeadActivity,
  type Employee,
  type ViewerRole,
} from "@/app/actions/leads";
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
import { trackLeadMutations } from "./lead-mutation-tracker";

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

const statuses = [
  "New",
  "Follow Up",
  "DNP",
  "DNP 3",
  "RNR",
  "Not Interested",
  "Budget Issue",
  "Location Issue",
  "Non Surgical",
  "OPD Booked",
  "OPD Done",
  "IPD Done",
  "Invalid Number",
  "Lost",
  "Won",
];
const temperatures = ["Hot", "Warm", "Cold"];

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

export function LeadsTable({
  leads: initialLeads,
  initialTotal,
  initialTotalPages,
  assignedTo = "",
  role = "employee",
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
  const [isImporting, setIsImporting] = useState(false);
  const [isAddLeadOpen, setIsAddLeadOpen] = useState(false);
  const [isCreatingLead, setIsCreatingLead] = useState(false);
  const [updatingLeadId, setUpdatingLeadId] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [leadEdits, setLeadEdits] = useState({ city: "", disease: "", insurance_status: "", remarks: "" });
  const [isSavingEdits, setIsSavingEdits] = useState(false);
  // "Edit Lead" modal: allows editing ALL fields of a single lead.
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    phone: "",
    email: "",
    city: "",
    disease: "",
    remarks: "",
    assigned_to: "",
    status: "",
    temperature: "",
    lead_date: "",
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
  const [quickNoteLead, setQuickNoteLead] = useState<Lead | null>(null);
  const [quickNote, setQuickNote] = useState("");
  const [isSavingQuickNote, setIsSavingQuickNote] = useState(false);
  const [selectedLeads, setSelectedLeads] = useState<string[]>([]);
  const [isBulkActionPending, setIsBulkActionPending] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [selectedSource, setSelectedSource] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  // The search term currently applied on the SERVER. Search runs in Supabase
  // (.or / .ilike across ALL leads in the database), not against the 50 rows
  // loaded on the current page.
  const [activeSearch, setActiveSearch] = useState("");
  const [selectedTemperature, setSelectedTemperature] = useState("all");
  // Advanced status filter (server-side): "" = all; Hot/Warm/Cold target the
  // temperature column, everything else targets the status column.
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [activeStatusFilter, setActiveStatusFilter] = useState("");
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

  const sourceOptions = Array.from(new Set(leads.map((lead) => lead.source)));
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
    const response = await getLeadsPage(nextPage, LEADS_PAGE_SIZE, search, assignedTo, status);
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
    const response = await getLeadsForExport(activeSearch, activeStatusFilter, assignedTo);
    if (!response.success) {
      toast.add({ title: "Export failed", description: response.error, type: "error" });
    } else {
      const rows = response.data.map((lead) => ({
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
      anchor.download = `leads-export-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      toast.add({ title: "Export ready", description: `${rows.length} leads downloaded as CSV.`, type: "success" });
    }
    setIsExporting(false);
  }

  useEffect(() => {
    void getEmployees().then((result) => {
      if (result.success) setEmployees(result.data);
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

      const { leads: importedLeads, skippedDuplicates, skippedRows } = response.data;
      // Mark imported rows as self-mutations so realtime notifications don't
      // toast the admin about their own bulk import.
      trackLeadMutations(importedLeads.map((lead) => lead.id));
      setLeads((previousLeads) => [...importedLeads, ...previousLeads]);
      setServerTotal((current) => current + importedLeads.length);
      toast.add({
        title: "Import complete",
        description:
          importedLeads.length === 0
            ? `No new leads were added — all ${skippedDuplicates} phone numbers already exist in the database.${skippedRows > 0 ? ` ${skippedRows} invalid rows were also skipped.` : ""}`
            : `${importedLeads.length} leads imported successfully.${skippedDuplicates > 0 ? ` ${skippedDuplicates} duplicate${skippedDuplicates === 1 ? "" : "s"} skipped (phone number already exists).` : ""}${skippedRows > 0 ? ` ${skippedRows} invalid rows skipped.` : ""}`,
        type: "success",
      });
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
    if (!status || status === lead.status) return;
    trackLeadMutations(lead.id);
    setUpdatingLeadId(lead.id);
    const response = await updateLeadStatus({ id: lead.id, status, temperature: lead.temperature });
    if (!response.success) {
      toast.add({ title: "Status update failed", description: response.error, type: "error" });
    } else {
      setLeads((currentLeads) => currentLeads.map((currentLead) => currentLead.id === lead.id ? response.data : currentLead));
      if (selectedLead?.id === lead.id) setSelectedLead(response.data);
    }
    setUpdatingLeadId(null);
  }

  async function handleAssignmentChange(lead: Lead, employeeName: string | null) {
    if (!employeeName || employeeName === lead.assigned_to) return;
    trackLeadMutations(lead.id);
    const response = await updateLeadAssignment(lead.id, employeeName);
    if (!response.success) {
      toast.add({ title: "Assignment update failed", description: response.error, type: "error" });
      return;
    }
    setLeads((currentLeads) => currentLeads.map((currentLead) => currentLead.id === lead.id ? response.data : currentLead));
    if (selectedLead?.id === lead.id) setSelectedLead(response.data);
  }

  async function handleTemperatureChange(lead: Lead, temperature: string | null) {
    if (!temperature || temperature === lead.temperature) return;
    trackLeadMutations(lead.id);
    const response = await updateLeadTemperature(lead.id, temperature);
    if (!response.success) {
      toast.add({ title: "Temperature update failed", description: response.error, type: "error" });
      return;
    }
    setLeads((currentLeads) => currentLeads.map((currentLead) => currentLead.id === lead.id ? response.data : currentLead));
    if (selectedLead?.id === lead.id) setSelectedLead(response.data);
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

  async function handleBulkDelete() {
    // When "select all" is active, delete with a single { deleteAll: true }
    // request instead of shipping thousands of IDs. If a server-side search is
    // active, the backend wipes only the leads matching that search.
    const deleteAll = isSelectAllChecked;
    setIsBulkActionPending(true);
    const response = await bulkDeleteLeads(deleteAll ? [] : selectedLeads, deleteAll, activeSearch, assignedTo);
    if (!response.success) {
      toast.add({ title: "Delete failed", description: response.error, type: "error" });
    } else {
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
      // Sync the server-rendered stat cards after revalidatePath on the server.
      router.refresh();
      toast.add({
        title: "Leads deleted",
        description: deleteAll
          ? activeSearch
            ? `All ${deletedCount} leads matching the search were deleted.`
            : `All ${deletedCount} leads were deleted.`
          : `${deletedCount} leads deleted.`,
        type: "success",
      });
    }
    setIsBulkActionPending(false);
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
    const response = await updateLeadDetails({ id: selectedLead.id, ...leadEdits });
    if (!response.success) {
      toast.add({ title: "Unable to save changes", description: response.error, type: "error" });
    } else {
      const updated = response.data;
      setLeads((currentLeads) => currentLeads.map((currentLead) => (currentLead.id === updated.id ? updated : currentLead)));
      setSelectedLead(updated);
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
      city: lead.city === "-" ? "" : lead.city,
      disease: lead.disease === "-" ? "" : lead.disease,
      remarks: lead.remarks === "-" ? "" : lead.remarks,
      assigned_to: lead.assigned_to && lead.assigned_to !== "-" ? lead.assigned_to : "",
      status: lead.status ?? "",
      temperature: lead.temperature ?? "",
      // Date input needs ISO format; unparseable stored values start empty.
      lead_date: parseLeadDateForSort(lead.lead_date) || "",
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
    const response = await updateLeadDetails(payload);
    if (!response.success) {
      toast.add({ title: "Unable to save changes", description: response.error, type: "error" });
    } else {
      const updated = response.data;
      // Smooth refresh: swap the saved row into the table state — no page reload.
      setLeads((currentLeads) => currentLeads.map((lead) => (lead.id === updated.id ? updated : lead)));
      if (selectedLead?.id === updated.id) setSelectedLead(updated);
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
    trackLeadMutations(lead.id);
    const response = await updateLeadFollowUpDate(lead.id, followUpDate);
    if (!response.success) {
      toast.add({ title: "Unable to update follow-up", description: response.error, type: "error" });
      return;
    }
    setLeads((currentLeads) => currentLeads.map((currentLead) => currentLead.id === lead.id ? response.data : currentLead));
    if (selectedLead?.id === lead.id) setSelectedLead(response.data);
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
            <Button type="button" onClick={() => setIsAddLeadOpen(true)}><Plus aria-hidden="true" />Add Lead</Button>
          </div>
          <div className="space-y-3 border-t border-slate-100 pt-4">
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
                    {sourceOptions.map((source) => <SelectItem key={source} value={source}>{source}</SelectItem>)}
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
                  <p className="text-xs text-slate-500">Tip: From aur To mein same date rakh ke kisi ek specific din pe filter karein.</p>
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
                <TableRow><TableCell colSpan={10} className="h-32 py-3 text-center text-slate-500">No leads found. Import a CSV or add a lead to get started.</TableCell></TableRow>
              ) : sortedLeads.map((lead) => (
                <TableRow key={lead.id}>
                  {canDelete && <TableCell className="w-10 py-3"><input type="checkbox" aria-label={`Select ${lead.name}`} checked={selectedLeads.includes(lead.id)} onChange={(event) => toggleLeadSelection(lead.id, event.target.checked)} /></TableCell>}
                  <TableCell className="w-[250px] max-w-[250px] py-3"><div className="flex items-center gap-1.5"><button type="button" className="min-w-0 flex-1 truncate text-left font-semibold text-slate-900 hover:underline" onClick={() => handleViewLead(lead)}>{lead.name}</button><button type="button" aria-label={`Edit ${lead.name}`} title="Edit lead" className="shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700" onClick={() => handleEditLead(lead)}><Pencil className="size-3.5" aria-hidden="true" /></button></div><p className="max-w-full break-words whitespace-normal text-xs text-muted-foreground">{lead.email}</p>{canSeeSource && <Badge className={`mt-1 ${sourceBadgeClass(lead.source)}`}>{lead.source}</Badge>}</TableCell>
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
                  <TableCell className="w-[130px] max-w-[130px] py-3"><p className="flex items-center gap-1 font-semibold text-slate-900"><CalendarDays className="size-4 shrink-0 text-slate-500" aria-hidden="true" />{formatLeadDateDisplay(lead.lead_date)}</p></TableCell>
                  <TableCell className="w-[140px] max-w-[140px] py-3"><p className="break-words whitespace-normal text-sm text-slate-700">{lead.city}</p></TableCell>
                  <TableCell className="w-[150px] max-w-[150px] py-3"><p className="break-words whitespace-normal text-sm text-muted-foreground">{lead.disease}</p></TableCell>
                  <TableCell className="w-[180px] py-3"><Select value={lead.status} onValueChange={(value) => handleStatusChange(lead, value)} disabled={updatingLeadId === lead.id}>
                    <SelectTrigger size="sm" aria-label={`Status for ${lead.name}`}><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-72 overflow-y-auto">{[...new Set([...statuses, lead.status])].map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent>
                  </Select></TableCell>
                  <TableCell className="w-[180px] py-3"><Select value={lead.temperature} onValueChange={(value) => handleTemperatureChange(lead, value)}>
                    <SelectTrigger size="sm" className="w-full max-w-[170px]"><SelectValue /></SelectTrigger>
                    <SelectContent>{temperatures.map((temperature) => <SelectItem key={temperature} value={temperature}>{temperature === "Hot" ? "Hot 🔥" : temperature === "Warm" ? "Warm ☀️" : "Cold ❄️"}</SelectItem>)}</SelectContent>
                  </Select></TableCell>
                  <TableCell className="w-[180px] py-3"><Select value={lead.assigned_to} onValueChange={(value) => handleAssignmentChange(lead, value)}>
                    <SelectTrigger size="sm" className="w-full max-w-[170px]"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                    <SelectContent><SelectItem value="-">Unassigned</SelectItem>{employees.map((employee) => <SelectItem key={employee.id} value={employee.name}>{employee.name}</SelectItem>)}</SelectContent>
                  </Select></TableCell>
                  <TableCell className="w-[250px] max-w-[250px] py-3"><div className="flex max-w-full items-start gap-2"><span className="line-clamp-2 min-w-0 break-words whitespace-normal text-xs text-slate-600" title={lead.remarks}>{lead.remarks}</span><Button type="button" variant="ghost" size="xs" className="shrink-0 whitespace-nowrap px-1.5" onClick={() => setQuickNoteLead(lead)}>✏️ Note</Button></div></TableCell>
                </TableRow>
              ))}
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
                ? activeSearch
                  ? `This permanently deletes ALL ${serverTotal.toLocaleString()} leads matching the search "${activeSearch}"${assignedTo ? ` assigned to ${assignedTo}` : ""} and their related activity history. This action cannot be undone.`
                  : `This permanently deletes ALL ${serverTotal.toLocaleString()} leads${assignedTo ? ` assigned to ${assignedTo}` : " in your pipeline"} and their related activity history. This action cannot be undone.`
                : `This permanently deletes ${selectedLeads.length} selected leads and their related activity history.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setIsDeleteConfirmOpen(false)}>Cancel</Button><Button type="button" variant="destructive" disabled={isBulkActionPending} onClick={() => void handleBulkDelete()}>{isBulkActionPending ? "Deleting..." : isSelectAllChecked ? (activeSearch ? "Delete All Matching" : "Delete All Leads") : "Delete Leads"}</Button></DialogFooter>
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
            <div className="space-y-1"><Label htmlFor="full-edit-city">City / Area</Label><Input id="full-edit-city" value={editForm.city} disabled={!canEditCore} onChange={(event) => setEditForm((current) => ({ ...current, city: event.target.value }))} /></div>
            <div className="space-y-1"><Label htmlFor="full-edit-disease">Treatment / Disease</Label><Input id="full-edit-disease" value={editForm.disease} disabled={!canEditCore} onChange={(event) => setEditForm((current) => ({ ...current, disease: event.target.value }))} /></div>
            <div className="space-y-1"><Label htmlFor="full-edit-date">Lead Date</Label><Input id="full-edit-date" type="date" value={editForm.lead_date} disabled={!canEditCore} onChange={(event) => setEditForm((current) => ({ ...current, lead_date: event.target.value }))} /></div>
            <div className="space-y-1"><Label htmlFor="full-edit-assigned">Assigned To</Label>
              <Select value={editForm.assigned_to || "unassigned"} onValueChange={(value) => setEditForm((current) => ({ ...current, assigned_to: value === "unassigned" ? "" : String(value ?? "") }))}>
                <SelectTrigger id="full-edit-assigned" disabled={!canEditCore}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {employees.map((employee) => <SelectItem key={employee.id} value={employee.name}>{employee.name}</SelectItem>)}
                </SelectContent>
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
                  <span className="text-xs text-slate-400">City, Treatment, Insurance &amp; Remarks yahan se edit kiye ja sakte hain.</span>
                </div>
                <div className="flex gap-2 text-xs sm:col-span-2"><span className="rounded-full bg-white px-2.5 py-1 text-slate-600 ring-1 ring-slate-200">{selectedLead.status}</span><span className="rounded-full bg-white px-2.5 py-1 text-slate-600 ring-1 ring-slate-200">{selectedLead.temperature}</span></div>
                <div className="sm:col-span-2"><Label htmlFor="drawer-follow-up-date">Next Follow-Up Date</Label><Input id="drawer-follow-up-date" type="date" className="w-full cursor-pointer" onClick={(event) => event.currentTarget.showPicker?.()} value={toInputDateValue(selectedLead.follow_up_date)} onChange={(event) => void handleFollowUpChange(selectedLead, event.target.value)} /></div>
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
