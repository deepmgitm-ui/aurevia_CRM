"use server";

import { revalidatePath } from "next/cache";

import { formatClock, normaliseStatus } from "@/lib/attendance";
import { createClient } from "@/lib/supabase/server";
import { stageForStatus } from "../overview/analytics";
import { toLocalIso } from "./month-grid";

export type CalendarResult<T> =
  | { success: true; data: T; error?: undefined }
  | { success: false; data?: undefined; error: string };

export type FollowUpKind = "followup" | "dnp" | "consultation";

export interface CalendarReminder {
  leadId: string;
  leadName: string;
  phone: string;
  leadStatus: string;
  /** yyyy-mm-dd the agent must act. */
  date: string;
  overdue: boolean;
  kind: FollowUpKind;
  /** Owning agent (shown only in the admin/manager team view). */
  agent: string;
}

export interface PersonalEvent {
  id: string;
  /** yyyy-mm-dd. */
  date: string;
  title: string;
  kind: string;
  notes: string;
}

/** A lead that was CREATED on a given day — the anchor of its timeline. */
export interface CreatedLead {
  leadId: string;
  leadName: string;
  status: string;
  source: string;
  agent: string;
}

/** One `lead_activities` row placed on the day it happened. */
export interface ActivityEntry {
  id: string;
  leadId: string;
  leadName: string;
  actionType: string;
  description: string;
  agent: string;
}

export interface CalendarDay {
  iso: string;
  day: number;
  isCurrentMonth: boolean;
  reminders: CalendarReminder[];
  personal: PersonalEvent[];
  created: CreatedLead[];
  activities: ActivityEntry[];
  /**
   * Attendance marks for this day. Empty for employees (they only ever see
   * their own row) and for any day nobody signed in on.
   */
  attendance: AttendanceMark[];
}

/** One employee's attendance on one day, as the calendar cell shows it. */
export interface AttendanceMark {
  id: string;
  employeeId: string;
  employeeName: string;
  /** yyyy-mm-dd the mark belongs to (needed to patch the right day cell). */
  date: string;
  status: string;
  /** "09:42" or "-" when a manager marked the day by hand. */
  checkInLabel: string;
  autoMarked: boolean;
  note: string;
}

/** Raw `attendance` row as PostgREST returns it (joined profile is obj|array). */
interface AttendanceDbMarkRow {
  id: string;
  employee_id: string;
  attendance_date: string;
  status: string | null;
  check_in_at: string | null;
  note: string | null;
  auto_marked: boolean | null;
  employee: { name: string | null } | { name: string | null }[] | null;
}

export interface MonthDays {
  month: string;
  days: CalendarDay[];
  overdue: CalendarReminder[];
  isTeamView: boolean;
}

const PERSONAL_KINDS = ["note", "call", "visit", "leave"];

const CALENDAR_TABLE_MISSING_ERROR =
  "calendar_events table abhi bani nahi hai — pehle supabase-calendar-migration.sql ko Supabase SQL editor me chalao.";

interface LeadReminderRow {
  id: string;
  name: string | null;
  phone: string | null;
  status: string | null;
  temperature: string | null;
  follow_up_date: string | null;
  assigned_to: string | null;
}

interface CalendarEventRow {
  id: string;
  owner_id: string;
  event_date: string;
  title: string;
  kind: string;
  notes: string | null;
}

interface CreatedLeadRow {
  id: string;
  name: string | null;
  status: string | null;
  source: string | null;
  assigned_to: string | null;
  created_at: string | null;
}

interface ActivityRow {
  id: string;
  lead_id: string;
  action_type: string | null;
  description: string | null;
  created_at: string | null;
  // Many-to-one joins come back as objects at runtime, but Supabase's untyped
  // client inference widens them to arrays — accept both and normalize.
  leads:
    | { name: string | null; assigned_to: string | null }
    | { name: string | null; assigned_to: string | null }[]
    | null;
}

function joinedLead(row: ActivityRow): { name: string | null; assigned_to: string | null } | null {
  return Array.isArray(row.leads) ? (row.leads[0] ?? null) : row.leads;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function toIsoDate(date: Date): string {
  return toLocalIso(date);
}

function reachedConsultation(stage: string): boolean {
  return stage === "booked" || stage === "attended" || stage === "surgery";
}

// Maps the lead rows Supabase returns (subset projection) to the UI shape.
function toCalendarReminder(
  row: {
    id: string;
    name: string | null;
    phone: string | null;
    status: string | null;
    temperature: string | null;
    follow_up_date: string | null;
    assigned_to: string | null;
  },
  today: string,
): CalendarReminder {
  const date = (row.follow_up_date ?? "").trim();
  const status = (row.status ?? "").trim() || "-";
  const lowerStatus = status.toLowerCase();
  const kind: FollowUpKind = /dnp|didn'?t pick|not pick|\brnr\b|no response/.test(lowerStatus)
    ? "dnp"
    : reachedConsultation(stageForStatus(status))
      ? "consultation"
      : "followup";
  return {
    leadId: row.id,
    leadName: (row.name ?? "").trim() || "Unnamed lead",
    phone: (row.phone ?? "").trim() || "-",
    leadStatus: status,
    date,
    overdue: date < today,
    kind,
    agent: (row.assigned_to ?? "").trim() || "-",
  };
}

/** Signed-in viewer, or null. All calendar queries are scoped to this person. */
async function getCalendarViewer(): Promise<
  | { userId: string; role: "admin" | "manager" | "employee"; name: string }
  | null
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role,name")
    .eq("id", user.id)
    .single();
  const role = profile?.role === "admin" || profile?.role === "manager" ? profile.role : "employee";
  const name =
    typeof profile?.name === "string" && profile.name.trim() ? profile.name.trim() : "Agent";
  return { userId: user.id, role, name };
}

/** yyyy-mm-dd for one remindable lead row (follow_up_date may be dd/mm/yyyy). */
function toCalendarDate(value: string | null): string {
  if (!value || value === "-") return "";
  const text = value.trim();
  const dayFirst = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(text);
  if (dayFirst) {
    const year = dayFirst[3].length === 2 ? Number(`20${dayFirst[3]}`) : Number(dayFirst[3]);
    const month = Number(dayFirst[2]);
    const day = Number(dayFirst[1]);
    if (!year || !month || !day) return "";
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return toIsoDate(parsed);
}

/** Month cells for `getMonthDays` — the real math lives in ./month-grid (Next
 *  forbids non-async exports from a "use server" file, so this file must not
 *  define or export it). */
async function monthCells(
  month: string,
): Promise<{ iso: string; day: number; isCurrentMonth: boolean }[]> {
  const grid = await import("./month-grid");
  return grid.buildMonthCells(month);
}

/**
 * One month of the plan calendar: follow-up dots from `leads.follow_up_date`
 * plus the viewer's own personal events. Employees see only their own leads;
 * admins/managers see the whole team. Personal events are ALWAYS the viewer's
 * own — the owner_id filter runs for every role.
 */
export async function getMonthDays(month?: string): Promise<CalendarResult<MonthDays>> {
  try {
    const viewer = await getCalendarViewer();
    if (!viewer) return { success: false, error: "Sign in to open your calendar." };

    const now = new Date();
    const target = /^\d{4}-\d{2}$/.test(month ?? "") ? month! : toIsoDate(now).slice(0, 7);
    const cells = await monthCells(target);
    const from = cells[0]!.iso;
    const to = cells[cells.length - 1]!.iso;
    const today = toIsoDate(now);

    const supabase = await createClient();
    const isTeamView = viewer.role === "admin" || viewer.role === "manager";

    // Reminders read live off leads.follow_up_date — this query stays tiny on
    // purpose: RLS already scopes rows to this viewer, so no extra filtering.
    const { data: leadRows, error: leadsError } = await supabase
      .from("leads")
      .select("id,name,phone,status,temperature,follow_up_date,assigned_to")
      .not("follow_up_date", "is", null)
      .neq("follow_up_date", "")
      .neq("follow_up_date", "-")
      .order("follow_up_date", { ascending: true })
      .limit(500);
    if (leadsError) return { success: false, error: leadsError.message };

    const byDay = new Map<string, CalendarReminder[]>();
    for (const row of (leadRows ?? []) as LeadReminderRow[]) {
      if (!isTeamView && (row.assigned_to ?? "").trim().toLowerCase() !== viewer.name.toLowerCase()) {
        continue;
      }
      const iso = toCalendarDate(row.follow_up_date);
      if (!iso || iso < from || iso > to) continue;
      const bucket = byDay.get(iso) ?? [];
      bucket.push(toCalendarReminder(row, today));
      byDay.set(iso, bucket);
    }

    const { data: eventRows, error: eventsError } = await supabase
      .from("calendar_events")
      .select("id,owner_id,event_date,title,kind,notes")
      .eq("owner_id", viewer.userId)
      .gte("event_date", from)
      .lte("event_date", to)
      .order("title", { ascending: true })
      .limit(500);
    if (eventsError) {
      if (eventsError.message.includes("calendar_events")) {
        return { success: false, error: CALENDAR_TABLE_MISSING_ERROR };
      }
      return { success: false, error: eventsError.message };
    }

    const personalByDay = new Map<string, PersonalEvent[]>();
    for (const row of (eventRows ?? []) as CalendarEventRow[]) {
      const bucket = personalByDay.get(row.event_date) ?? [];
      bucket.push({
        id: row.id,
        date: row.event_date,
        title: row.title,
        kind: PERSONAL_KINDS.includes(row.kind) ? row.kind : "note",
        notes: row.notes ?? "",
      });
      personalByDay.set(row.event_date, bucket);
    }

    // --- Timeline lanes: leads CREATED and lead ACTIVITIES in this month ---
    // created_at/created are timestamptz (UTC) while the grid is local-day, so
    // query a wide UTC window and bucket by the LOCAL calendar day to avoid
    // entries landing on the wrong date near midnight/timezone edges.
    const windowFrom = new Date(`${from}T00:00:00`).toISOString();
    const windowTo = new Date(`${to}T23:59:59.999`);
    windowTo.setUTCDate(windowTo.getUTCDate() + 2);
    const windowToIso = windowTo.toISOString();

    const createdByDay = new Map<string, CreatedLead[]>();
    try {
      const { data: createdRows } = await supabase
        .from("leads")
        .select("id, name, status, source, assigned_to, created_at")
        .gte("created_at", windowFrom)
        .lte("created_at", windowToIso)
        .order("created_at", { ascending: false })
        .limit(500);
      for (const row of (createdRows ?? []) as CreatedLeadRow[]) {
        if (!row.created_at) continue;
        const local = toIsoDate(new Date(row.created_at));
        if (local < from || local > to) continue;
        const bucket = createdByDay.get(local) ?? [];
        bucket.push({
          leadId: row.id,
          leadName: (row.name ?? "").trim() || "Unnamed lead",
          status: (row.status ?? "").trim() || "-",
          source: (row.source ?? "").trim() || "-",
          agent: (row.assigned_to ?? "").trim() || "-",
        });
        createdByDay.set(local, bucket);
      }
    } catch {
      // Non-fatal: the calendar still works without the creation lane.
    }

    const activitiesByDay = new Map<string, ActivityEntry[]>();
    try {
      const { data: activityRows } = await supabase
        .from("lead_activities")
        .select("id, lead_id, action_type, description, created_at, leads(name, assigned_to)")
        .gte("created_at", windowFrom)
        .lte("created_at", windowToIso)
        .order("created_at", { ascending: false })
        .limit(500);
      for (const row of (activityRows ?? []) as ActivityRow[]) {
        if (!row.created_at) continue;
        const local = toIsoDate(new Date(row.created_at));
        if (local < from || local > to) continue;
        const lead = joinedLead(row);
        const bucket = activitiesByDay.get(local) ?? [];
        bucket.push({
          id: row.id,
          leadId: row.lead_id,
          leadName: (lead?.name ?? "").trim() || "Lead",
          actionType: (row.action_type ?? "").trim() || "update",
          description: (row.description ?? "").trim(),
          agent: (lead?.assigned_to ?? "").trim() || "-",
        });
        activitiesByDay.set(local, bucket);
      }
    } catch {
      // Non-fatal: employees see this lane once the SELECT policy is deployed.
    }

    // --- Attendance lane: who signed in on which day, with the check-in time ---
    // The table is optional (it ships with supabase-hr-migration.sql), so a
    // missing relation degrades to an empty lane instead of breaking the
    // calendar. Employees only ever see their own row — the RLS SELECT policy
    // enforces that, this just decides whether to even ask.
    const attendanceByDay = new Map<string, AttendanceMark[]>();
    try {
      let attendanceQuery = supabase
        .from("attendance")
        .select("id, employee_id, attendance_date, status, check_in_at, note, employee:profiles!attendance_employee_id_fkey(name)")
        .gte("attendance_date", from)
        .lte("attendance_date", to)
        .order("check_in_at", { ascending: true, nullsFirst: false })
        .limit(1000);
      if (!isTeamView) attendanceQuery = attendanceQuery.eq("employee_id", viewer.userId);

      const { data: attendanceRows, error: attendanceError } = await attendanceQuery;
      if (attendanceError && !attendanceError.message.includes("attendance")) {
        throw new Error(attendanceError.message);
      }

      for (const row of (attendanceRows ?? []) as AttendanceDbMarkRow[]) {
        const employee = Array.isArray(row.employee) ? row.employee[0] : row.employee;
        const bucket = attendanceByDay.get(String(row.attendance_date)) ?? [];
        bucket.push({
          id: row.id,
          employeeId: row.employee_id,
          employeeName: (employee?.name ?? "").trim() || "Employee",
          date: String(row.attendance_date),
          status: normaliseStatus(row.status),
          checkInLabel: row.check_in_at ? formatClock(row.check_in_at) : "-",
          autoMarked: Boolean(row.auto_marked),
          note: row.note ?? "",
        });
        attendanceByDay.set(String(row.attendance_date), bucket);
      }
    } catch {
      // Non-fatal: the calendar renders without the attendance lane.
    }

    const days: CalendarDay[] = cells.map((cell) => ({
      ...cell,
      reminders: byDay.get(cell.iso) ?? [],
      personal: personalByDay.get(cell.iso) ?? [],
      created: createdByDay.get(cell.iso) ?? [],
      activities: activitiesByDay.get(cell.iso) ?? [],
      attendance: attendanceByDay.get(cell.iso) ?? [],
    }));
    const total = days.flatMap((day) => day.reminders);
    const overdue = total.filter((item) => item.overdue);
    return { success: true, data: { month: target, days, overdue, isTeamView } };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Unable to load the calendar.") };
  }
}

/** Move one follow-up to tomorrow (keeps the queue flowing, no typing). */
export async function postponeFollowUp(leadId: string, fromIso: string): Promise<CalendarResult<true>> {
  if (!leadId) return { success: false, error: "Lead ID is required." };
  try {
    const [year, month, day] = fromIso.split("-").map(Number);
    if (!year || !month || !day) return { success: false, error: "Date samajh nahi aayi." };
    const next = new Date(year, month - 1, day + 1);
    const supabase = await createClient();
    const { error } = await supabase
      .from("leads")
      .update({ follow_up_date: toIsoDate(next) })
      .eq("id", leadId);
    if (error) return { success: false, error: error.message };
    revalidatePath("/dashboard/calendar");
    return { success: true, data: true };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Postpone nahi ho paya.") };
  }
}

/** Clearing a follow-up only resets the date ("-" hides it from the page). */
export async function clearFollowUp(leadId: string): Promise<CalendarResult<true>> {
  if (!leadId) return { success: false, error: "Lead ID is required." };
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("leads").update({ follow_up_date: "-" }).eq("id", leadId);
    if (error) return { success: false, error: error.message };
    revalidatePath("/dashboard/calendar");
    return { success: true, data: true };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Clear nahi ho paya.") };
  }
}

/** Finishing a call: status → Contacted, follow-up date cleared, activity logged. */
export async function markFollowUpDone(leadId: string): Promise<CalendarResult<true>> {
  if (!leadId) return { success: false, error: "Lead ID is required." };
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("leads")
      .update({ status: "Contacted", follow_up_date: "-" })
      .eq("id", leadId);
    if (error) return { success: false, error: error.message };
    await supabase.from("lead_activities").insert({
      lead_id: leadId,
      action_type: "follow_up_done",
      description: "Follow-up calendar se done mark kiya gaya.",
    });
    revalidatePath("/dashboard/calendar");
    return { success: true, data: true };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Done mark nahi ho paya.") };
  }
}


function cleanPersonalInput(input: { title?: string; kind?: string; notes?: string; date?: string }):
  | { error: string }
  | { title: string; kind: string; notes: string; date: string } {
  const title = (input.title ?? "").trim().slice(0, 120);
  const kind = (input.kind ?? "note").trim().toLowerCase();
  const notes = (input.notes ?? "").trim().slice(0, 1000);
  const date = (input.date ?? "").trim();
  if (!title) return { error: "Event ko ek title do." };
  if (!PERSONAL_KINDS.includes(kind)) return { error: "Type note, call, visit ya leave me se ho." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Date samajh nahi aayi." };
  return { title, kind, notes, date };
}

/** A personal event always belongs to the signed-in user — owner_id is server-set. */
export async function createPersonalEvent(input: {
  date: string;
  title: string;
  kind?: string;
  notes?: string;
}): Promise<CalendarResult<PersonalEvent>> {
  try {
    const viewer = await getCalendarViewer();
    if (!viewer) return { success: false, error: "Sign in to add events." };
    const cleaned = cleanPersonalInput(input);
    if ("error" in cleaned) return { success: false, error: cleaned.error };
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("calendar_events")
      .insert({
        owner_id: viewer.userId,
        event_date: cleaned.date,
        title: cleaned.title,
        kind: cleaned.kind,
        notes: cleaned.notes || null,
      })
      .select("id,event_date,title,kind,notes")
      .single();
    if (error) {
      if (error.message.includes("calendar_events")) return { success: false, error: CALENDAR_TABLE_MISSING_ERROR };
      return { success: false, error: error.message };
    }
    revalidatePath("/dashboard/calendar");
    const row = data as CalendarEventRow;
    return {
      success: true,
      data: {
        id: row.id,
        date: row.event_date,
        title: row.title,
        kind: PERSONAL_KINDS.includes(row.kind) ? row.kind : "note",
        notes: row.notes ?? "",
      },
    };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Event add nahi ho paya.") };
  }
}

/** Only the owner can edit — the owner_id check runs in the query itself. */
export async function updatePersonalEvent(
  id: string,
  input: { title?: string; kind?: string; notes?: string },
): Promise<CalendarResult<PersonalEvent>> {
  try {
    const viewer = await getCalendarViewer();
    if (!viewer) return { success: false, error: "Sign in to edit events." };
    const cleaned = cleanPersonalInput(input);
    if ("error" in cleaned) return { success: false, error: cleaned.error };
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("calendar_events")
      .update({ title: cleaned.title, kind: cleaned.kind, notes: cleaned.notes || null })
      .eq("id", id)
      .eq("owner_id", viewer.userId)
      .select("id,event_date,title,kind,notes")
      .single();
    if (error) return { success: false, error: error.message };
    revalidatePath("/dashboard/calendar");
    const row = data as CalendarEventRow;
    return {
      success: true,
      data: {
        id: row.id,
        date: row.event_date,
        title: row.title,
        kind: PERSONAL_KINDS.includes(row.kind) ? row.kind : "note",
        notes: row.notes ?? "",
      },
    };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Event update nahi ho paya.") };
  }
}

/** Only the owner can delete — the owner_id check runs in the query itself. */
export async function deletePersonalEvent(id: string): Promise<CalendarResult<true>> {
  try {
    const viewer = await getCalendarViewer();
    if (!viewer) return { success: false, error: "Sign in to delete events." };
    const supabase = await createClient();
    const { error } = await supabase.from("calendar_events").delete().eq("id", id).eq("owner_id", viewer.userId);
    if (error) return { success: false, error: error.message };
    revalidatePath("/dashboard/calendar");
    return { success: true, data: true };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Event delete nahi ho paya.") };
  }
}

// ---------------------------------------------------------------------------
// Lead timeline — the full journey of ONE lead, oldest first: creation anchor,
// then every logged update (status changes, notes, follow-ups, calls). This is
// what "ek lead, uske saare updates date ke saath" means on the calendar.
// ---------------------------------------------------------------------------

export interface TimelineItem {
  id: string;
  date: string;
  actionType: string;
  description: string;
  agent: string;
}

export interface LeadTimeline {
  leadId: string;
  leadName: string;
  phone: string;
  status: string;
  source: string;
  city: string;
  disease: string;
  assignedTo: string;
  createdAt: string;
  followUpDate: string;
  items: TimelineItem[];
}

interface TimelineActivityRow {
  id: string;
  action_type: string | null;
  description: string | null;
  created_at: string | null;
}

export async function getLeadTimeline(leadId: string): Promise<CalendarResult<LeadTimeline>> {
  if (!leadId) return { success: false, error: "Lead ID is required." };
  try {
    const supabase = await createClient();
    const { data: lead, error } = await supabase
      .from("leads")
      .select("id,name,phone,status,source,city,disease,assigned_to,follow_up_date,created_at")
      .eq("id", leadId)
      .single();
    if (error || !lead) {
      return { success: false, error: error?.message ?? "Lead nahi mila (aapki access me nahi hai)." };
    }

    const agent = (lead.assigned_to ?? "").trim() || "-";
    const createdAt = lead.created_at ? toIsoDate(new Date(lead.created_at)) : "";
    const rawFollowUp = (lead.follow_up_date ?? "").trim();
    const followUpDate = /^\d{4}-\d{2}-\d{2}$/.test(rawFollowUp) ? rawFollowUp : "";

    const { data: activityRows } = await supabase
      .from("lead_activities")
      .select("id, action_type, description, created_at")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: true })
      .limit(200);

    const items: TimelineItem[] = [];
    if (createdAt) {
      items.push({ id: "created", date: createdAt, actionType: "created", description: "Lead add hua", agent });
    }
    for (const row of (activityRows ?? []) as TimelineActivityRow[]) {
      if (!row.created_at) continue;
      items.push({
        id: row.id,
        date: toIsoDate(new Date(row.created_at)),
        actionType: (row.action_type ?? "").trim() || "update",
        description: (row.description ?? "").trim(),
        agent,
      });
    }
    items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    return {
      success: true,
      data: {
        leadId: lead.id,
        leadName: (lead.name ?? "").trim() || "Unnamed lead",
        phone: (lead.phone ?? "").trim() || "-",
        status: (lead.status ?? "").trim() || "-",
        source: (lead.source ?? "").trim() || "-",
        city: (lead.city ?? "").trim() || "-",
        disease: (lead.disease ?? "").trim() || "-",
        assignedTo: agent,
        createdAt,
        followUpDate,
        items,
      },
    };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Timeline load nahi ho paya.") };
  }
}

// ---------------------------------------------------------------------------
// Composer search — find a lead by name/phone so a follow-up can be scheduled
// straight from the calendar. RLS keeps employees scoped to their own leads.
// ---------------------------------------------------------------------------

export interface LeadSearchResult {
  leadId: string;
  leadName: string;
  phone: string;
  status: string;
  agent: string;
}

interface LeadSearchRow {
  id: string;
  name: string | null;
  phone: string | null;
  status: string | null;
  assigned_to: string | null;
}

export async function searchLeadsForCalendar(query: string): Promise<CalendarResult<LeadSearchResult[]>> {
  const q = (query ?? "").trim().replace(/[%_]/g, "");
  if (q.length < 2) return { success: true, data: [] };
  try {
    const viewer = await getCalendarViewer();
    if (!viewer) return { success: false, error: "Sign in required." };
    const isTeamView = viewer.role === "admin" || viewer.role === "manager";
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("leads")
      .select("id,name,phone,status,assigned_to")
      .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
      .order("created_at", { ascending: false })
      .limit(8);
    if (error) return { success: false, error: error.message };
    let rows = (data ?? []) as LeadSearchRow[];
    if (!isTeamView) {
      rows = rows.filter((row) => (row.assigned_to ?? "").trim().toLowerCase() === viewer.name.toLowerCase());
    }
    return {
      success: true,
      data: rows.map((row) => ({
        leadId: row.id,
        leadName: (row.name ?? "").trim() || "Unnamed lead",
        phone: (row.phone ?? "").trim() || "-",
        status: (row.status ?? "").trim() || "-",
        agent: (row.assigned_to ?? "").trim() || "-",
      })),
    };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Lead search nahi ho paya.") };
  }
}