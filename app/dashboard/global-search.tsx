"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, LoaderCircle, Search, UserRound } from "lucide-react";

import { searchLeadsForGlobalSearch, type GlobalLeadSearchResult } from "@/app/actions/leads";
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

export function GlobalSearch({ role }: { role: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [leads, setLeads] = useState<GlobalLeadSearchResult[]>([]);
  const [resultsFor, setResultsFor] = useState("");
  const [searchError, setSearchError] = useState("");
  const term = query.trim();
  const normalizedTerm = term.toLocaleLowerCase();

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

  useEffect(() => {
    if (!open || term.length < 2) return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearchError("");
      const result = await searchLeadsForGlobalSearch(term);
      if (cancelled) return;
      setResultsFor(term);
      if (result.success) setLeads(result.data);
      else {
        setLeads([]);
        setSearchError("Search could not be completed. Please try again.");
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, term]);

  const visibleDestinations = destinations.filter(
    (item) => item.roles.some((allowedRole) => allowedRole === role) &&
      (!normalizedTerm || item.label.toLocaleLowerCase().includes(normalizedTerm)),
  );

  function closeSearch() {
    setOpen(false);
    setQuery("");
    setLeads([]);
    setResultsFor("");
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className="h-9 gap-2 rounded-xl border border-emerald-900/10 bg-white/80 px-3 text-slate-600 shadow-sm transition-all hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800"
        aria-label="Search leads and CRM sections"
        onClick={() => setOpen(true)}
      >
        <Search className="size-4" aria-hidden="true" />
        <span className="hidden sm:inline">Search</span>
        <kbd className="hidden rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-400 xl:inline">⌘ K</kbd>
      </Button>

      <Dialog open={open} onOpenChange={(nextOpen) => nextOpen ? setOpen(true) : closeSearch()}>
        <DialogContent className="grid-rows-[auto_auto_minmax(0,1fr)_auto] h-[min(82dvh,42rem)] max-h-[min(82dvh,42rem)] gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="border-b border-emerald-950/10 px-5 py-4">
            <DialogTitle>Search Aurevia</DialogTitle>
            <DialogDescription>Find a lead or open any section in your workspace.</DialogDescription>
          </DialogHeader>
          <div className="border-b border-slate-100 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <Input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by patient, phone, treatment, city, status..."
                aria-label="Search leads and CRM sections"
                className="h-12 rounded-xl pl-9"
              />
            </div>
          </div>
          <div className="min-h-0 overflow-y-auto overscroll-y-contain p-2">
            {normalizedTerm && visibleDestinations.length > 0 && (
              <section aria-label="CRM sections" className="mb-2">
                <h3 className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Sections</h3>
                {visibleDestinations.map((item) => (
                  <Link key={item.href} href={item.href} onClick={closeSearch} className="group flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-emerald-50 hover:text-emerald-800 focus-visible:bg-emerald-50 focus-visible:outline-none">
                    <span>{item.label}</span>
                    <ArrowRight className="size-4 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-emerald-700" aria-hidden="true" />
                  </Link>
                ))}
              </section>
            )}

            {normalizedTerm.length >= 2 && (
              <section aria-label="Matching leads">
                <h3 className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Leads</h3>
                {resultsFor !== term ? (
                  <p className="flex items-center gap-2 px-3 py-5 text-sm text-slate-500"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />Searching leads...</p>
                ) : searchError ? (
                  <p role="status" className="px-3 py-5 text-sm text-rose-600">{searchError}</p>
                ) : resultsFor === term && leads.length > 0 ? leads.map((lead) => (
                  <Link key={lead.id} href={`/dashboard/leads?q=${encodeURIComponent(term)}&openLead=${encodeURIComponent(lead.id)}`} onClick={closeSearch} className="group flex items-center gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-emerald-50 focus-visible:bg-emerald-50 focus-visible:outline-none">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><UserRound className="size-4" aria-hidden="true" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-800">{lead.name}</span>
                      <span className="block truncate text-xs text-slate-500">{[lead.phone, lead.city, lead.disease].filter((value) => value && value !== "-").join(" · ")}</span>
                    </span>
                    <span className="hidden rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200 sm:inline-flex">{lead.status}</span>
                    <ArrowRight className="size-4 text-slate-300 group-hover:text-emerald-700" aria-hidden="true" />
                  </Link>
                )) : (
                  <p className="px-3 py-4 text-sm text-slate-500">{term.length < 2 ? "Type at least 2 characters to search leads." : "No matching leads found."}</p>
                )}
              </section>
            )}

            {!normalizedTerm && (
              <p className="px-3 py-8 text-center text-sm text-slate-500">Start typing to search leads, or search a section name.</p>
            )}
          </div>
          <p className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-400">Press Esc to close · Ctrl / ⌘ K to open</p>
        </DialogContent>
      </Dialog>
    </>
  );
}
