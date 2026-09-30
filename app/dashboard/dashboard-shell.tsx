"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  BarChart3,
  CalendarDays,
  CheckSquare,
  ChevronDown,
  CircleCheck,
  Kanban,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  Settings,
  Stethoscope,
  UserCheck,
  UserCog,
  UserRound,
  Users,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { logout } from "@/app/login/actions";
import { currentQuarterRange, formatRangeLabel, type DateRange } from "./overview/analytics";
import { RealtimeNotifications } from "./realtime-notifications";

interface DashboardProfile {
  name: string;
  role: "admin" | "manager" | "employee";
}

interface DashboardShellProps {
  children: React.ReactNode;
  profile: DashboardProfile;
  /**
   * Today's automatic check-in, stamped by the layout on sign-in. Shown as a
   * quiet "when did I come in" chip; null when attendance isn't available.
   */
  attendanceToday?: { status: string; checkInLabel: string } | null;
}

// Sidebar modules, exactly as in the Aurevia HealthCare design reference.
const navigation = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, exact: true },
  { label: "Leads", href: "/dashboard/leads", icon: Users, exact: false },
  { label: "Pipeline Board", href: "/dashboard/board", icon: Kanban, exact: false },
  { label: "Consultations", href: "/dashboard/consultations", icon: CalendarDays, exact: false },
  { label: "Surgeries", href: "/dashboard/surgeries", icon: Stethoscope, exact: false },
  { label: "Patients", href: "/dashboard/patients", icon: UserRound, exact: false },
  { label: "Agents", href: "/dashboard/agents", icon: UserCog, exact: false },
  { label: "Marketing", href: "/dashboard/marketing", icon: Megaphone, exact: false },
  { label: "Reports", href: "/dashboard/reports", icon: BarChart3, exact: false },
  { label: "Settings", href: "/dashboard/settings", icon: Settings, exact: false },
] as const;

/**
 * Admin-only modules. Kept out of `navigation` so an employee never even sees
 * the link; the page repeats the check on the server, because hiding a link is
 * not a permission.
 */
const managerNavigation = [
  { label: "Attendance", href: "/dashboard/attendance", icon: UserCheck, exact: false },
] as const;

// Secondary (in-dashboard) tab navigation shown in the top white bar.
const topTabs = [
  { label: "Overview", href: "/dashboard", exact: true },
  { label: "Pipeline Board", href: "/dashboard/board", exact: false },
  { label: "Lead Analysis", href: "/dashboard/lead-analysis", exact: false },
  { label: "Consultations", href: "/dashboard/consultations", exact: false },
  { label: "Surgeries", href: "/dashboard/surgeries", exact: false },
  { label: "Source Analysis", href: "/dashboard/source-analysis", exact: false },
  { label: "Agents Performance", href: "/dashboard/agents", exact: false },
  { label: "City Analysis", href: "/dashboard/city-analysis", exact: false },
  { label: "My Calendar", href: "/dashboard/calendar", exact: false },
] as const;

function isActivePath(pathname: string, href: string, exact: boolean): boolean {
  return exact ? pathname === href : pathname.startsWith(href);
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

// Official company logo (public/logo.png, transparent background). The
// intrinsic dimensions (1693x929) give next/image the file's aspect ratio, so
// the CSS height scales it cleanly without stretching.
function BrandLogo({
  className = "h-10 w-auto object-contain bg-transparent",
  sizes = "160px",
  preload = false,
}: {
  className?: string;
  sizes?: string;
  preload?: boolean;
}) {
  return (
    <Image
      src="/logo.png"
      alt="Aurevia CRM Logo"
      width={1693}
      height={929}
      sizes={sizes}
      preload={preload}
      className={className}
    />
  );
}

function Navigation({ mobile = false, role }: { mobile?: boolean; role: DashboardProfile["role"] }) {
  const pathname = usePathname();
  const isManager = role === "admin" || role === "manager";
  const items = isManager ? [...navigation, ...managerNavigation] : navigation;

  return (
    <nav className="space-y-1.5">
      {items.map(({ label, href, icon: Icon, exact }) => {
        const isActive = isActivePath(pathname, href, exact);
        const link = (
          <Link
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-[#1e3a8a] text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
            )}
          >
            <Icon className="size-4.5" aria-hidden="true" />
            {label}
          </Link>
        );

        return mobile ? <SheetClose key={href}>{link}</SheetClose> : <div key={href}>{link}</div>;
      })}
    </nav>
  );
}

function Sidebar({ profile }: { profile: DashboardProfile }) {
  return (
    <aside className="hidden w-[236px] shrink-0 border-r border-slate-200 bg-white lg:flex lg:flex-col">
      <div className="flex h-20 items-center justify-center px-4">
        <BrandLogo className="h-11 w-auto object-contain bg-transparent" preload />
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-4">
        <Navigation role={profile.role} />
      </div>
      {/* Faint brand watermark at the foot of the sidebar, as in the design. */}
      <div className="relative mt-auto overflow-hidden px-4 pt-6 pb-3">
        <div className="pointer-events-none absolute -bottom-4 left-1/2 size-40 -translate-x-1/2 opacity-[0.05]">
          <BrandLogo className="h-40 w-auto object-contain" sizes="160px" />
        </div>
        <div className="relative flex flex-col items-center gap-0.5 text-center">
          <p className="text-[11px] font-semibold text-slate-400">Aurevia HealthCare</p>
          <p className="text-[10px] text-slate-300">Care you can Trust</p>
        </div>
      </div>
      <div className="border-t border-slate-200 p-3">
        <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
          <Avatar size="sm">
            <AvatarFallback>{getInitials(profile.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-900">{profile.name}</p>
            <p className="truncate text-xs capitalize text-slate-500">{profile.role}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

function MobileNavigation({ profile }: { profile: DashboardProfile }) {
  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
            <Menu aria-hidden="true" />
          </Button>
        }
      />
      <SheetContent side="left" className="w-72 max-w-[85vw] p-0">
        <SheetHeader className="border-b border-slate-200 px-6 py-5">
          <SheetTitle className="flex items-center">
            <BrandLogo className="h-9 w-auto object-contain bg-transparent" sizes="120px" />
          </SheetTitle>
        </SheetHeader>
        <div className="flex flex-1 flex-col px-4 py-6">
          <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Workspace
          </p>
          <Navigation mobile role={profile.role} />
          <div className="mt-auto flex items-center gap-3 border-t border-slate-200 px-3 pt-5">
            <Avatar size="sm">
              <AvatarFallback>{getInitials(profile.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">{profile.name}</p>
              <p className="truncate text-xs capitalize text-slate-500">{profile.role}</p>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function TopTabs({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Dashboard sections"
      className={cn(
        "flex items-center gap-1",
        // Desktop: the tabs share ONE header row with the date button + icons, so
        // cap the strip and scroll it instead of sliding underneath them.
        mobile
          ? "overflow-x-auto pb-1"
          : "w-fit max-w-full overflow-x-auto rounded-full border border-slate-200 bg-slate-50/80 p-1",
      )}
    >
      {topTabs.map(({ label, href, exact }) => {
        const isActive = isActivePath(pathname, href, exact);
        return (
          <Link
            key={href}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              isActive
                ? "bg-[#1e3a8a] text-white shadow-sm"
                : "text-slate-600 hover:bg-white hover:text-slate-900",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

// Date-range button on the right of the header ("01 Jul 2026 - 30 Sep 2026").
function HeaderRangeButton({ range, onChange }: { range: DateRange; onChange: (range: DateRange) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange>(range);
  // Re-sync the draft whenever the parent range changes (header picker, URL
  // window). Adjusted during render — React's "adjust state when props change"
  // pattern — so it never costs an extra cascading render.
  const [draftSource, setDraftSource] = useState<DateRange>(range);
  if (draftSource.from !== range.from || draftSource.to !== range.to) {
    setDraftSource(range);
    setDraft(range);
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
            aria-label="Select dashboard date range"
          >
            <CalendarDays className="size-4 text-slate-500" aria-hidden="true" />
            <span className="hidden whitespace-nowrap min-[480px]:inline">{formatRangeLabel(range)}</span>
            <ChevronDown className="size-4 text-slate-400" aria-hidden="true" />
          </button>
        }
      />
      <PopoverContent className="w-72 space-y-3" align="end">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="header-range-from">From</Label>
            <Input
              id="header-range-from"
              type="date"
              value={draft.from}
              onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="header-range-to">To</Label>
            <Input
              id="header-range-to"
              type="date"
              value={draft.to}
              onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))}
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              const quarter = currentQuarterRange();
              setDraft(quarter);
              onChange(quarter);
              setIsOpen(false);
            }}
          >
            This quarter
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              onChange(draft);
              setIsOpen(false);
            }}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** "Aaj: Present · 09:42" — proof that signing in marked the day. */
function AttendanceChip({
  attendance,
}: {
  attendance: { status: string; checkInLabel: string };
}) {
  return (
    <span
      title="Aaj ki attendance — login karte hi mark ho gayi"
      className="hidden items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 md:inline-flex"
    >
      <CircleCheck aria-hidden="true" />
      {attendance.status}
      {attendance.checkInLabel !== "-" && (
        <span className="text-emerald-600">· {attendance.checkInLabel}</span>
      )}
    </span>
  );
}

export function DashboardShell({ children, profile, attendanceToday }: DashboardShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [range, setRange] = useState<DateRange>(() => currentQuarterRange());

  // The header range lives in the URL (?from=&to=) so the server components
  // (Overview + every analysis page) read exactly the same window. Read it from
  // useSearchParams and fold it into local state during render, so no effect (and
  // no cascading render) is needed — and a query change without navigation is
  // picked up too.
  const searchParams = useSearchParams();
  const urlFrom = searchParams.get("from");
  const urlTo = searchParams.get("to");
  const [urlRange, setUrlRange] = useState<{ from: string | null; to: string | null }>({
    from: urlFrom,
    to: urlTo,
  });
  if (urlRange.from !== urlFrom || urlRange.to !== urlTo) {
    setUrlRange({ from: urlFrom, to: urlTo });
    if (urlFrom || urlTo) {
      setRange((current) => ({ from: urlFrom ?? current.from, to: urlTo ?? current.to }));
    }
  }

  const handleRangeChange = (next: DateRange) => {
    setRange(next);
    const params = new URLSearchParams(window.location.search);
    if (next.from) params.set("from", next.from);
    if (next.to) params.set("to", next.to);
    router.replace(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar profile={profile} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
            <MobileNavigation profile={profile} />
            <div className="hidden min-w-0 flex-1 items-center lg:flex">
              <TopTabs />
            </div>
            <div className="ml-auto flex items-center gap-2 sm:gap-3">
              {attendanceToday && <AttendanceChip attendance={attendanceToday} />}
              <HeaderRangeButton range={range} onChange={handleRangeChange} />
              <RealtimeNotifications />
              <Link
                href="/dashboard/tasks"
                aria-label="Tasks"
                className="hidden items-center gap-2 rounded-full border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 sm:flex"
              >
                <CheckSquare className="size-4" aria-hidden="true" />
                <span className="hidden xl:inline">Tasks</span>
              </Link>
              <div className="hidden text-right lg:block">
                <p className="text-sm font-medium text-slate-900">{profile.name}</p>
                <p className="text-xs capitalize text-slate-500">{profile.role}</p>
              </div>
              <Avatar>
                <AvatarFallback>{getInitials(profile.name)}</AvatarFallback>
              </Avatar>
              <form action={logout}>
                <Button type="submit" variant="ghost" size="icon" aria-label="Log out">
                  <LogOut aria-hidden="true" />
                </Button>
              </form>
            </div>
          </div>
          {/* Tab row for phones / tablets, where the sidebar is collapsed. */}
          <div className="px-4 pb-3 sm:px-6 lg:hidden">
            <TopTabs mobile />
          </div>
        </header>
        <main className="flex-1 bg-slate-50 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
