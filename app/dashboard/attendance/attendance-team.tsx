"use client";

// Aurevia CRM — the employee strip above the attendance calendar.
//
// Each employee is a CARD, not a row in a dropdown: a manager opening this
// screen wants to know "who is missing today?" at a glance, and nobody
// remembers which avatar belongs to whom. Tapping a card is the whole
// interaction — it filters the calendar below to that one person, so their
// month reads like a personal register.
//
// Everything displayed here is derived by pure helpers in lib/attendance.ts,
// which the verifier pins, so this file stays a presentation concern only.

import { useMemo, useState } from "react";

import { CalendarDays, Flame, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  buildTeamCards,
  initialsFor,
  statusOn,
  type AttendanceRow,
  type AttendanceStatus,
} from "@/lib/attendance";

type SortKey = "name" | "rate" | "absent";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Naam" },
  { key: "rate", label: "Attendance" },
  { key: "absent", label: "Absent zyada" },
];

function rateTone(rate: number, total: number) {
  if (total === 0) return { text: "text-slate-400", bar: "bg-slate-300" };
  if (rate >= 90) return { text: "text-emerald-600", bar: "bg-emerald-500" };
  if (rate >= 70) return { text: "text-amber-600", bar: "bg-amber-500" };
  return { text: "text-rose-600", bar: "bg-rose-500" };
}

function statusChip(status: AttendanceStatus) {
  if (status === "Absent") return "bg-rose-100 text-rose-700";
  if (status === "Half-Day") return "bg-amber-100 text-amber-700";
  return "bg-emerald-100 text-emerald-700";
}

function RoleBadge({ role }: { role: string }) {
  if (role !== "admin" && role !== "manager") return null;
  return (
    <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-indigo-700 uppercase">
      {role}
    </span>
  );
}
export function AttendanceTeam({
  rows,
  roster,
  todayIso,
  selectedId,
  onSelect,
}: {
  rows: AttendanceRow[];
  roster: { id: string; name: string; role: string; phone: string | null; photo_url: string | null }[];
  todayIso: string;
  /** null = the whole team is showing. */
  selectedId: string | null;
  onSelect: (employeeId: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");

  const cards = useMemo(() => buildTeamCards(roster, rows), [roster, rows]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = needle
      ? cards.filter((card) => card.employeeName.toLowerCase().includes(needle))
      : cards;

    return [...matched].sort((a, b) => {
      if (sortKey === "rate") return b.rate - a.rate || a.employeeName.localeCompare(b.employeeName);
      if (sortKey === "absent") return b.absent - a.absent || a.employeeName.localeCompare(b.employeeName);
      return a.employeeName.localeCompare(b.employeeName);
    });
  }, [cards, query, sortKey]);

  if (cards.length === 0) return null;

  return (
    <section aria-label="Employees" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Employees</h2>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            {cards.length}
          </span>
          {selectedId && (
            <Button size="xs" variant="ghost" onClick={() => onSelect(null)}>
              <X aria-hidden="true" />
              All employees
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search employees"
              aria-label="Employee search"
              className="h-8 w-44 pl-8 text-xs"
            />
          </div>
          <div className="flex items-center gap-1" role="group" aria-label="Sort employees">
            {SORT_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setSortKey(option.key)}
                aria-pressed={sortKey === option.key}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  sortKey === option.key
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>
{visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
          No employees match “{query}”.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((card) => {
            const person = roster.find((entry) => entry.id === card.employeeId);
            const tone = rateTone(card.rate, card.total);
            const todayStatus = statusOn(rows, card.employeeId, todayIso);
            const isSelected = selectedId === card.employeeId;

            return (
              <li key={card.employeeId}>
                <button
                  type="button"
                  onClick={() => onSelect(isSelected ? null : card.employeeId)}
                  aria-pressed={isSelected}
                  className={`flex h-full w-full flex-col rounded-xl border bg-white p-4 text-left shadow-sm transition-all hover:shadow-md focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none ${
                    isSelected
                      ? "border-indigo-400 ring-2 ring-indigo-100"
                      : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {person?.photo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={person.photo_url}
                        alt=""
                        className="size-10 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
                        {initialsFor(card.employeeName)}
                      </span>
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {card.employeeName}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        {person?.role && <RoleBadge role={person.role} />}
                        {person?.phone && (
                          <span className="truncate text-xs text-slate-500">{person.phone}</span>
                        )}
                      </div>
                    </div>

                    <div className="text-right">
                      <p className={`text-lg leading-tight font-semibold ${tone.text}`}>
                        {card.total === 0 ? "—" : `${card.rate}%`}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {card.total === 0 ? "no marks" : `${card.total} days`}
                      </p>
                    </div>
                  </div>

                  {/* Attendance bar — the fastest single read on the card. */}
                  <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full ${tone.bar}`}
                      style={{ width: `${card.total === 0 ? 0 : card.rate}%` }}
                    />
                  </div>

                  <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div>
                      <dt className="text-[10px] tracking-wide text-slate-400 uppercase">Present</dt>
                      <dd className="text-sm font-semibold text-emerald-600">{card.present}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] tracking-wide text-slate-400 uppercase">Half</dt>
                      <dd className="text-sm font-semibold text-amber-600">{card.halfDay}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] tracking-wide text-slate-400 uppercase">Absent</dt>
                      <dd className="text-sm font-semibold text-rose-600">{card.absent}</dd>
                    </div>
                  </dl>

                  <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2.5 text-[11px] text-slate-500">
                    {todayStatus ? (
                      <span className={`rounded-full px-2 py-0.5 font-semibold ${statusChip(todayStatus)}`}>
                        Today: {todayStatus}
                      </span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-500">
                        Today: not marked
                      </span>
                    )}
                    {card.streak > 1 && (
                      <span className="inline-flex items-center gap-1">
                        <Flame className="size-3 text-emerald-600" aria-hidden="true" />
                        {card.streak}-day streak
                      </span>
                    )}
                    {card.averageCheckIn !== "-" && (
                      <span className="ml-auto inline-flex items-center gap-1">
                        <CalendarDays className="size-3 text-slate-400" aria-hidden="true" />
                        {card.averageCheckIn} avg
                      </span>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}