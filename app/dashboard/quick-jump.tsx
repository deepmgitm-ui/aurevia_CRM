"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const destinations = [
  { label: "Dashboard", href: "/dashboard", roles: ["admin", "manager", "employee"] },
  { label: "Follow-ups", href: "/dashboard/tasks", roles: ["admin", "manager", "employee"] },
  { label: "Calendar", href: "/dashboard/calendar", roles: ["admin", "manager", "employee"] },
  { label: "Daily Team Report", href: "/dashboard/daily-report", roles: ["admin", "manager"] },
  { label: "Leads", href: "/dashboard/leads", roles: ["admin", "manager", "employee"] },
  { label: "Pipeline Board", href: "/dashboard/board", roles: ["admin", "manager"] },
  { label: "Attendance", href: "/dashboard/attendance", roles: ["admin", "manager", "employee"] },
  { label: "Consultations", href: "/dashboard/consultations", roles: ["admin", "manager"] },
  { label: "Surgeries", href: "/dashboard/surgeries", roles: ["admin", "manager"] },
  { label: "Patients", href: "/dashboard/patients", roles: ["admin", "manager"] },
  { label: "Agents", href: "/dashboard/agents", roles: ["admin", "manager", "employee"] },
  { label: "Marketing", href: "/dashboard/marketing", roles: ["admin", "manager"] },
  { label: "Reports", href: "/dashboard/reports", roles: ["admin", "manager"] },
  { label: "Settings", href: "/dashboard/settings", roles: ["admin", "manager"] },
] as const;

export function QuickJump({ role }: { role: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  const search = query.trim().toLocaleLowerCase();
  const visibleDestinations = destinations.filter(
    (item) => item.roles.some((allowedRole) => allowedRole === role) &&
      (!search || item.label.toLocaleLowerCase().includes(search)),
  );

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className="h-9 gap-2 rounded-full border border-emerald-900/10 bg-white/70 px-3 text-slate-600 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800"
        aria-label="Quick jump to a CRM section"
        onClick={() => setOpen(true)}
      >
        <Search className="size-4" aria-hidden="true" />
        <span className="hidden xl:inline">Quick jump</span>
        <kbd className="hidden rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-400 xl:inline">Ctrl / ⌘ K</kbd>
      </Button>

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) setQuery("");
        }}
      >
        <DialogContent className="max-h-[min(80dvh,34rem)] gap-0 overflow-hidden p-0 sm:max-w-xl">
          <DialogHeader className="border-b border-emerald-950/10 px-5 py-4">
            <DialogTitle>Go to a section</DialogTitle>
            <DialogDescription>Search your workspace and jump straight in.</DialogDescription>
          </DialogHeader>
          <div className="border-b border-slate-100 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <Input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search dashboard, leads, calendar..."
                aria-label="Search CRM sections"
                className="h-11 rounded-xl pl-9"
              />
            </div>
          </div>
          <ul className="overflow-y-auto p-2" aria-label="CRM sections">
            {visibleDestinations.length ? visibleDestinations.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => {
                    setOpen(false);
                    setQuery("");
                  }}
                  className="group flex items-center justify-between rounded-xl px-3 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-emerald-50 hover:text-emerald-800 focus-visible:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                >
                  <span>{item.label}</span>
                  <ArrowRight className="size-4 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-emerald-700" aria-hidden="true" />
                </Link>
              </li>
            )) : (
              <li className="px-3 py-8 text-center text-sm text-slate-500">No section matches “{query}”.</li>
            )}
          </ul>
          <p className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-400">Press Esc to close · Ctrl K to open</p>
        </DialogContent>
      </Dialog>
    </>
  );
}
