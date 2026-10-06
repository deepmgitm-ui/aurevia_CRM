"use client";

// Aurevia CRM — the attendance register, as its own month calendar.
//
// Attendance lives separately from the OPD/IPD appointments calendar. Managers
// can edit the team register; employees can view their own read-only calendar.
//
// One dot per employee per day (green present / amber half-day / rose absent),
// and the day panel is where a manager corrects or deletes a mark, or adds one
// for someone who never signed in.
import { useMemo, useState } from "react";

import { ChevronLeft, ChevronRight, CircleCheck, UserCheck } from "lucide-react";

import {
  deleteAttendance,
  getMyAttendance,
  getTeamAttendance,
  markAttendance,
  updateAttendance,
} from "@/app/actions/attendance";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import {
  ATTENDANCE_STATUSES,
  summariseByEmployee,
  type AttendanceRow,
  type AttendanceStatus,
} from "@/lib/attendance";

import { buildMonthCells } from "../calendar/month-grid";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function dotClass(status: AttendanceStatus) {
  if (status === "Absent") return "bg-rose-500";
  if (status === "Half-Day") return "bg-amber-500";
  return "bg-emerald-500";
}

function badgeClass(status: AttendanceStatus) {
  if (status === "Absent") return "bg-rose-100 text-rose-800";
  if (status === "Half-Day") return "bg-amber-100 text-amber-800";
  return "bg-emerald-100 text-emerald-800";
}

function monthLabel(month: string) {
  const [year, monthText] = month.split("-");
  return new Date(Number(year), Number(monthText) - 1, 1).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
}

function shiftMonth(month: string, delta: number) {
  const [year, monthText] = month.split("-").map(Number);
  const date = new Date(year, monthText - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** Rows keyed by their day, earliest sign-in first. */
function groupByDate(list: AttendanceRow[]): Record<string, AttendanceRow[]> {
  const grouped: Record<string, AttendanceRow[]> = {};
  for (const row of list) (grouped[row.date] ||= []).push(row);
  for (const day of Object.values(grouped)) {
    day.sort((a, b) => (a.checkInAt ?? "").localeCompare(b.checkInAt ?? ""));
  }
  return grouped;
}

export function AttendanceCalendar({
  rows,
  month,
  todayIso,
  canManage,
  employees,
  focusEmployeeId = null,
  focusEmployeeName = null,
}: {
  rows: AttendanceRow[];
  month: string;
  todayIso: string;
  canManage: boolean;
  /** Roster, so a manager can add a day for someone who never signed in. */
  employees: { id: string; name: string }[];
  /** When set, the grid shows only this person and the header names them. */
  focusEmployeeId?: string | null;
  focusEmployeeName?: string | null;
}) {
  const [monthCursor, setMonthCursor] = useState(month);
  const [selectedIso, setSelectedIso] = useState(todayIso);
  const [data, setData] = useState<Record<string, AttendanceRow[]>>(() => groupByDate(rows));
  const [isLoadingMonth, setIsLoadingMonth] = useState(false);
  const [monthError, setMonthError] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [addEmployee, setAddEmployee] = useState("");
  const [addStatus, setAddStatus] = useState<AttendanceStatus>("Absent");

  const cells = useMemo(() => buildMonthCells(monthCursor), [monthCursor]);

  /**
   * Focus mode. Tapping an employee card narrows BOTH the grid dots and the
   * day panel to that person, so the grid stops being a wall of six colours
   * and starts reading as one person's month.
   *
   * The mark is applied to the derived view only — `data` still holds every
   * employee's rows, so clearing the focus brings the whole team straight back
   * without a refetch or a lost edit.
   */
  const focusRows = useMemo(
    () => {
      const currentRows = Object.values(data).flat();
      return focusEmployeeId
        ? currentRows.filter((row) => row.employeeId === focusEmployeeId)
        : currentRows;
    },
    [data, focusEmployeeId],
  );

  /** The focused person's own totals, so the header can show their rate. */
  const focusStats = useMemo(
    () => (focusEmployeeId ? summariseByEmployee(focusRows)[0] : undefined),
    [focusRows, focusEmployeeId],
  );

  const selected = useMemo(
    () => (data[selectedIso] ?? []).filter((row) => !focusEmployeeId || row.employeeId === focusEmployeeId),
    [data, selectedIso, focusEmployeeId],
  );

  // Someone who has no row for this day yet — the only people a manager can add.
  const unmarked = employees.filter(
    (person) =>
      !selected.some((row) => row.employeeId === person.id) &&
      (!focusEmployeeId || person.id === focusEmployeeId),
  );

  function replaceRow(row: AttendanceRow) {
    setData((current) => {
      const day = current[row.date] ?? [];
      const exists = day.some((item) => item.id === row.id);
      return {
        ...current,
        [row.date]: exists ? day.map((item) => (item.id === row.id ? row : item)) : [...day, row],
      };
    });
  }

  function removeRow(row: AttendanceRow) {
    setData((current) => ({
      ...current,
      [row.date]: (current[row.date] ?? []).filter((item) => item.id !== row.id),
    }));
  }

  async function moveMonth(delta: number) {
    if (isLoadingMonth) return;
    const nextMonth = shiftMonth(monthCursor, delta);
    setMonthCursor(nextMonth);
    setSelectedIso(`${nextMonth}-01`);
    setIsLoadingMonth(true);
    setMonthError("");
    setData({});

    const response = canManage
      ? await getTeamAttendance(nextMonth)
      : await getMyAttendance(nextMonth);
    if (!response.success) {
      setMonthError(response.error);
    } else {
      setData(groupByDate(response.data.rows));
    }
    setIsLoadingMonth(false);
  }

  async function changeStatus(row: AttendanceRow, status: AttendanceStatus) {
    if (row.status === status || busyKey === row.id) return;
    setBusyKey(row.id);
    replaceRow({ ...row, status });
    const response = await updateAttendance({ id: row.id, status });
    setBusyKey(null);
    if (!response.success) {
      replaceRow(row);
      toast.add({ title: "Could not update", description: response.error, type: "error" });
      return;
    }
    replaceRow(response.data);
    toast.add({ title: `${response.data.employeeName} — ${response.data.status}` });
  }

  async function remove(row: AttendanceRow) {
    if (busyKey === row.id) return;
    setBusyKey(row.id);
    removeRow(row);
    const response = await deleteAttendance(row.id);
    setBusyKey(null);
    if (!response.success) {
      replaceRow(row);
      toast.add({ title: "Could not delete", description: response.error, type: "error" });
      return;
    }
    toast.add({ title: "Attendance record deleted", type: "success" });
  }

  /**
   * Adds a day for someone who never signed in (leave, a missed sign-in, or a
   * correction applied by hand). Defaults to Absent so an accidental add is
   * visibly wrong rather than silently crediting an absent day.
   */
  async function addMark() {
    if (!addEmployee) return;
    setBusyKey(`add-${selectedIso}`);
    const response = await markAttendance({
      employeeId: addEmployee,
      date: selectedIso,
      status: addStatus,
    });
    setBusyKey(null);
    if (!response.success) {
      toast.add({ title: "Could not mark", description: response.error, type: "error" });
      return;
    }
    replaceRow(response.data);
    setAddEmployee("");
    toast.add({ title: `${response.data.employeeName} — ${response.data.status}` });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">{monthLabel(monthCursor)}</h2>
              {focusEmployeeId && focusStats && (
                <p className="mt-0.5 text-xs text-slate-500">
                  {focusEmployeeName ?? focusStats.employeeName} — {focusStats.rate}% attendance ·{" "}
                  {focusStats.present} present · {focusStats.absent} absent
                  {focusStats.averageCheckIn !== "-" && ` · ${focusStats.averageCheckIn} avg login`}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-label="Previous month"
                disabled={isLoadingMonth}
                onClick={() => void moveMonth(-1)}
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-label="Next month"
                disabled={isLoadingMonth}
                onClick={() => void moveMonth(1)}
              >
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
            {WEEKDAY_LABELS.map((label) => (
              <span key={label} className="py-1">
                {label}
              </span>
            ))}
          </div>

          {isLoadingMonth && (
            <p className="mt-2 text-xs text-slate-500" role="status">
              Loading attendance...
            </p>
          )}
          {monthError && (
            <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700" role="alert">
              {monthError}
            </p>
          )}
          <div className="mt-1 grid grid-cols-7 gap-1" aria-busy={isLoadingMonth}>
            {cells.map((cell) => {
              // Focus mode shows one dot per day, so the cell can be a proper
              // status tile instead of a row of tiny specks.
              const dayRows = (focusEmployeeId
                ? (data[cell.iso] ?? []).filter((row) => row.employeeId === focusEmployeeId)
                : (data[cell.iso] ?? []));
              const isSelected = cell.iso === selectedIso;
              return (
                <button
                  key={cell.iso}
                  type="button"
                  onClick={() => setSelectedIso(cell.iso)}
                  className={`flex min-h-16 flex-col rounded-lg border p-1 text-left transition-colors ${
                    isSelected
                      ? "border-blue-500 bg-blue-50/60"
                      : cell.isCurrentMonth
                        ? "border-slate-200 bg-white hover:border-blue-300"
                        : "border-slate-100 bg-slate-50/60"
                  }`}
                >
                  <span
                    className={`text-xs font-semibold ${
                      cell.iso === todayIso ? "text-blue-600" : "text-slate-500"
                    }`}
                  >
                    {cell.day}
                  </span>
                  {focusEmployeeId ? (
                    <span className="mt-1">
                      {dayRows[0] ? (
                        <span
                          className={`block truncate rounded px-1 py-0.5 text-[9px] font-semibold ${badgeClass(dayRows[0].status)}`}
                        >
                          {dayRows[0].status === "Half-Day" ? "H" : dayRows[0].status === "Present" ? "P" : "A"}
                        </span>
                      ) : (
                        cell.isCurrentMonth && (
                          <span className="block rounded bg-slate-100 px-1 py-0.5 text-center text-[9px] text-slate-400">
                            —
                          </span>
                        )
                      )}
                    </span>
                  ) : (
                    <span className="mt-1 flex flex-wrap gap-0.5">
                      {dayRows.slice(0, 6).map((row) => (
                        <span
                          key={row.id}
                          className={`size-2 rounded-full ${dotClass(row.status)}`}
                          title={`${row.employeeName} · ${row.status}`}
                        />
                      ))}
                      {dayRows.length > 6 && (
                        <span className="text-[9px] font-semibold text-slate-500">
                          +{dayRows.length - 6}
                        </span>
                      )}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            {focusEmployeeId
              ? `${focusEmployeeName ?? "This employee"} — ${monthLabel(monthCursor)}. Each tile shows that day's status (P / H / A). Tap a day for details.`
              : "Each dot is one employee — green = Present, amber = Half-Day, red = Absent. Tap a day to see everyone marked on it."}
          </p>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardContent className="space-y-3 p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <UserCheck className="size-4" aria-hidden="true" /> {selectedIso}
          </h2>

          {selected.length === 0 ? (
            <p className="rounded-lg bg-slate-50 px-3 py-3 text-xs text-slate-500">
              Nobody signed in on this day — no attendance marked.
            </p>
          ) : null}

          {canManage && unmarked.length > 0 ? (
            <div className="space-y-2 rounded-lg border border-dashed border-slate-300 p-3">
              <p className="text-xs font-semibold text-slate-600">
                Mark attendance for an employee who did not sign in on {selectedIso}.
              </p>
              <Select value={addEmployee} onValueChange={(value) => setAddEmployee(value ?? "")}>
                <SelectTrigger size="sm" className="w-full text-xs">
                  <SelectValue placeholder="Select an employee" />
                </SelectTrigger>
                <SelectContent>
                  {unmarked.map((person) => (
                    <SelectItem key={person.id} value={person.id}>
                      {person.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1.5">
                <Select
                  value={addStatus}
                  onValueChange={(value) => value && setAddStatus(value as AttendanceStatus)}
                >
                  <SelectTrigger size="sm" className="w-auto text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ATTENDANCE_STATUSES.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  size="sm"
                  disabled={!addEmployee || busyKey === `add-${selectedIso}`}
                  onClick={() => void addMark()}
                >
                  {busyKey === `add-${selectedIso}` ? "Marking..." : "Mark"}
                </Button>
              </div>
            </div>
          ) : null}

          {selected.map((row) => (
            <div key={row.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">{row.employeeName}</p>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badgeClass(row.status)}`}
                >
                  {row.status}
                </span>
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                {row.checkInLabel === "-" ? (
                  <span>No login time (entered by manager)</span>
                ) : (
                  <span className="inline-flex items-center gap-1 font-medium text-slate-700">
                    <CircleCheck className="size-3" aria-hidden="true" /> Signed in at {row.checkInLabel}
                  </span>
                )}
                {row.autoMarked && <span>· Automatically recorded</span>}
              </p>
              {row.note && <p className="mt-1 text-xs text-slate-500">{row.note}</p>}

              {canManage && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Select
                    value={row.status}
                    disabled={busyKey === row.id}
                    onValueChange={(value) =>
                      value ? void changeStatus(row, value as AttendanceStatus) : undefined
                    }
                  >
                    <SelectTrigger size="sm" className="h-7 w-auto text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ATTENDANCE_STATUSES.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    disabled={busyKey === row.id}
                    onClick={() => void remove(row)}
                  >
                    Delete
                  </Button>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
