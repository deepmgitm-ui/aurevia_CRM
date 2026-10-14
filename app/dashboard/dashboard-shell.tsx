"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  BarChart3,
  CalendarDays,
  CheckSquare,
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

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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
import { currentQuarterRange, type DateRange } from "./overview/analytics";
import { DashboardDateRangeProvider } from "./dashboard-date-range";
import { RealtimeNotifications } from "./realtime-notifications";
import { ActivityTracker } from "./activity-tracker";
import { AssistantChat } from "./assistant-chat";
import { GlobalSearch } from "./global-search";

interface DashboardProfile {
  name: string;
  role: "admin" | "manager" | "employee";
  photo_url: string | null;
}

interface DashboardShellProps {
  children: React.ReactNode;
  profile: DashboardProfile;
  /**
   * Today's automatic check-in, stamped by the layout on sign-in. Shown as a
   * quiet "when did I come in" chip; null when attendance isn't available.
   */
  attendanceToday?: { status: string; checkInLabel: string } | null;
  /**
   * The window the server actually resolved for this request. Without it the
   * header would always say "this quarter" while the cards show the month the
   * data really lives in.
   */
  initialRange?: DateRange;
}

// Sidebar modules, exactly as in the Aurevia HealthCare design reference.
const navigation = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, exact: true },
  { label: "Follow-ups", href: "/dashboard/tasks", icon: CheckSquare, exact: false },
  { label: "Calendar", href: "/dashboard/calendar", icon: CalendarDays, exact: false },
  { label: "Daily Team Report", href: "/dashboard/daily-report", icon: BarChart3, exact: false },
  { label: "Leads", href: "/dashboard/leads", icon: Users, exact: false },
  { label: "Pipeline Board", href: "/dashboard/board", icon: Kanban, exact: false },
  { label: "Attendance", href: "/dashboard/attendance", icon: UserCheck, exact: false },
  { label: "Consultations", href: "/dashboard/consultations", icon: CalendarDays, exact: false },
  { label: "Surgeries", href: "/dashboard/surgeries", icon: Stethoscope, exact: false },
  { label: "Patients", href: "/dashboard/patients", icon: UserRound, exact: false },
  { label: "Agents", href: "/dashboard/agents", icon: UserCog, exact: false },
  { label: "Marketing", href: "/dashboard/marketing", icon: Megaphone, exact: false },
  { label: "Reports", href: "/dashboard/reports", icon: BarChart3, exact: false },
  { label: "Settings", href: "/dashboard/settings", icon: Settings, exact: false },
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
  { label: "Upcoming Appointments", href: "/dashboard/calendar", exact: false },
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

function Navigation({ mobile = false, role }: { mobile?: boolean; role?: string }) {
  const pathname = usePathname();
  const items = role === "employee" ? navigation.filter(item=>["/dashboard","/dashboard/leads","/dashboard/tasks","/dashboard/calendar","/dashboard/attendance","/dashboard/agents","/dashboard/daily-report"].includes(item.href)).map(item=>item.href==="/dashboard/daily-report"?{...item,label:"My Daily Summary"}:item) : navigation;

  return (
    <nav className="space-y-1.5">
      {items.map(({ label, href, icon: Icon, exact }) => {
        const isActive = isActivePath(pathname, href, exact);
        const link = (
          <Link
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all duration-200 hover:translate-x-0.5 focus-visible:outline-2 focus-visible:outline-emerald-600 motion-reduce:transform-none",
              isActive
                ? "bg-gradient-to-r from-emerald-700 to-emerald-600 text-white shadow-md shadow-emerald-900/15 ring-1 ring-white/20"
                : "text-slate-600 hover:bg-emerald-50/80 hover:text-emerald-800",
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
    <aside className="hidden w-[248px] shrink-0 border-r border-emerald-950/10 bg-gradient-to-b from-white via-white/95 to-emerald-50/55 lg:flex lg:flex-col">
      <div className="flex h-20 items-center justify-center border-b border-emerald-950/[0.045] px-4">
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
        <Link
          href="/dashboard/agents?editProfile=1"
          aria-label="Open and edit your profile"
          className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 transition-colors hover:bg-blue-50"
        >
          <Avatar size="sm">
            {profile.photo_url && <AvatarImage src={profile.photo_url} alt="" />}
            <AvatarFallback>{getInitials(profile.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-900">{profile.name}</p>
            <p className="truncate text-xs capitalize text-slate-500">{profile.role}</p>
          </div>
        </Link>
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
          <SheetClose
            render={
              <Link
                href="/dashboard/agents?editProfile=1"
                aria-label="Open and edit your profile"
                className="mt-auto flex items-center gap-3 border-t border-slate-200 px-3 pt-5"
              >
                <Avatar size="sm">
                  {profile.photo_url && <AvatarImage src={profile.photo_url} alt="" />}
                  <AvatarFallback>{getInitials(profile.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {profile.name}
                  </p>
                  <p className="truncate text-xs capitalize text-slate-500">{profile.role}</p>
                </div>
              </Link>
            }
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function TopTabs({ mobile = false, role }: { mobile?: boolean; role?: string }) {
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
          : "w-fit max-w-full overflow-x-auto rounded-full border border-emerald-900/10 bg-white/65 p-1 shadow-inner shadow-emerald-950/[0.025] backdrop-blur",
      )}
    >
      {(role === "employee" ? [{label:"My day",href:"/dashboard",exact:true},{label:"Leads",href:"/dashboard/leads",exact:false},{label:"Follow-ups",href:"/dashboard/tasks",exact:false},{label:"Calendar",href:"/dashboard/calendar",exact:false}] : topTabs).map(({ label, href, exact }) => {
        const isActive = isActivePath(pathname, href, exact);
        return (
          <Link
            key={href}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              isActive
                ? "bg-gradient-to-r from-emerald-700 to-emerald-600 text-white shadow-md shadow-emerald-900/15"
                : "text-slate-600 hover:bg-emerald-50 hover:text-emerald-800",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** "Today: Present · 09:42" — confirms that signing in marked the day. */
function AttendanceChip({
  attendance,
}: {
  attendance: { status: string; checkInLabel: string };
}) {
  return (
    <span
      title="Today's attendance — marked automatically when you signed in"
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

export function DashboardShell({ children, profile, attendanceToday, initialRange }: DashboardShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  // Seeded from the server's resolved window so the button and the cards agree;
  // ?from/?to in the URL still overrides it below, which is the user's choice.
  const [range, setRange] = useState<DateRange>(() => initialRange ?? currentQuarterRange());

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
    <div className="crm-app-shell flex min-h-screen">
      <ActivityTracker />
      <Sidebar profile={profile} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-emerald-950/10 bg-white/78 shadow-[0_8px_24px_-22px_rgba(6,78,59,0.38)] backdrop-blur-xl">
          <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
            <MobileNavigation profile={profile} />
            <div className="hidden min-w-0 flex-1 items-center lg:flex">
              <TopTabs role={profile.role} />
            </div>
            <div className="ml-auto flex items-center gap-2 sm:gap-3">
              {attendanceToday && <AttendanceChip attendance={attendanceToday} />}
              <RealtimeNotifications />
              <GlobalSearch role={profile.role} />
              <Link
                href="/dashboard/tasks"
                aria-label="Tasks"
                className="flex items-center gap-2 rounded-full border border-emerald-900/10 bg-white/70 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 sm:flex"
              >
                <CheckSquare className="size-4" aria-hidden="true" />
                <span className="hidden xl:inline">Tasks</span>
              </Link>
              <div className="hidden text-right lg:block">
                <Link
                  href="/dashboard/agents?editProfile=1"
                  aria-label="Open and edit your profile"
                  className="group"
                >
                  <p className="text-sm font-medium text-slate-900 group-hover:text-blue-700">{profile.name}</p>
                  <p className="text-xs capitalize text-slate-500">{profile.role}</p>
                </Link>
              </div>
              <Link href="/dashboard/agents?editProfile=1" aria-label="Open and edit your profile">
                <Avatar>
                  {profile.photo_url && <AvatarImage src={profile.photo_url} alt="" />}
                  <AvatarFallback>{getInitials(profile.name)}</AvatarFallback>
                </Avatar>
              </Link>
              <form action={logout}>
                <Button type="submit" variant="ghost" size="icon" aria-label="Log out">
                  <LogOut aria-hidden="true" />
                </Button>
              </form>
            </div>
          </div>
          {/* Tab row for phones / tablets, where the sidebar is collapsed. */}
          <div className="px-4 pb-3 sm:px-6 lg:hidden">
            <TopTabs mobile role={profile.role} />
          </div>
        </header>
        <DashboardDateRangeProvider value={{ range, onChange: handleRangeChange }}>
          <main className="crm-main-content flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
        </DashboardDateRangeProvider>
        <AssistantChat role={profile.role} />
      </div>
    </div>
  );
}
