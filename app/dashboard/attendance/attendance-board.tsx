"use client";

// Aurevia CRM — attendance screen: the employee cards and the calendar.
//
// Both halves have to live in ONE client component. The selected employee is
// shared state — the card strip draws it as "selected", and the calendar reads
// it to decide whether to show the whole team or one person's month. Splitting
// them across two components would mean lifting that state to the page and
// dragging the whole month's rows through a URL, which is worse: tapping a
// face should feel instant and local, not like a page navigation.

import { useState } from "react";

import { AttendanceCalendar } from "./attendance-calendar";
import { AttendanceRequests } from "./attendance-requests";
import { AttendanceTeam } from "./attendance-team";
import type { AttendanceRow } from "@/lib/attendance";

export function AttendanceBoard({
  rows,
  month,
  todayIso,
  canManage,
  employees,
  viewerEmployeeId,
  viewerEmployeeName,
}: {
  rows: AttendanceRow[];
  month: string;
  todayIso: string;
  canManage: boolean;
  employees: { id: string; name: string; role: string; phone: string | null; photo_url: string | null }[];
  viewerEmployeeId: string | null;
  viewerEmployeeName: string | null;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(viewerEmployeeId);

  // Resolved from the roster rather than passed down, so a card for somebody
  // with no marks at all still labels their calendar correctly.
  const selectedName = viewerEmployeeName ?? (selectedId
    ? (employees.find((person) => person.id === selectedId)?.name ?? null)
    : null);

  return (
    <div className="space-y-4">
      {canManage && (
        <AttendanceTeam
          rows={rows}
          roster={employees}
          todayIso={todayIso}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      )}
      <AttendanceRequests canManage={canManage} todayIso={todayIso} />
      <AttendanceCalendar
        rows={rows}
        month={month}
        todayIso={todayIso}
        canManage={canManage}
        // The calendar's "add a mark" dropdown only needs id + name.
        employees={employees.map((person) => ({ id: person.id, name: person.name }))}
        focusEmployeeId={selectedId}
        focusEmployeeName={selectedName}
      />
    </div>
  );
}