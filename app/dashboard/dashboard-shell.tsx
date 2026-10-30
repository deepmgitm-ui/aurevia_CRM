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
  pendingDeletionReviews?: number;
}

// Keep every workspace destination in the sidebar so the header stays focused.
const navigation = [
  { group: "Overview", label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, exact: true },
  { group: "Leads & Follow-ups", label: "Follow-ups", href: "/dashboard/tasks", icon: CheckSquare, exact: false },
  { group: "Leads & Follow-ups", label: "Leads", href: "/dashboard/leads", icon: Users, exact: false },
  { group: "Leads & Follow-ups", label: "Follow-up Calendar", href: "/dashboard/follow-up-calendar", icon: CalendarDays, exact: false },
  { group: "Leads & Follow-ups", label: "Pipeline Board", href: "/dashboard/board", icon: Kanban, exact: false },
  { group: "Clinic", label: "Attendance", href: "/dashboard/attendance", icon: UserCheck, exact: false },
  { group: "Clinic", label: "Upcoming Appointments", href: "/dashboard/calendar", icon: CalendarDays, exact: false },
  { group: "Clinic", label: "Consultations", href: "/dashboard/consultations", icon: CalendarDays, exact: false },
  { group: "Clinic", label: "Surgeries", href: "/dashboard/surgeries", icon: Stethoscope, exact: false },
  { group: "Analytics", label: "Lead Analysis", href: "/dashboard/lead-analysis", icon: BarChart3, exact: false },
  { group: "Analytics", label: "Source Analysis", href: "/dashboard/source-analysis", icon: Megaphone, exact: false },
  { group: "Analytics", label: "City Analysis", href: "/dashboard/city-analysis", icon: CalendarDays, exact: false },
  { group: "Analytics", label: "Agents Performance", href: "/dashboard/agents", icon: UserCog, exact: false },
  { group: "Analytics", label: "Daily Team Report", href: "/dashboard/daily-report", icon: BarChart3, exact: false },
  { group: "Analytics", label: "Reports", href: "/dashboard/reports", icon: BarChart3, exact: false },
  { group: "Tools", label: "Marketing", href: "/dashboard/marketing", icon: Megaphone, exact: false },
  { group: "Tools", label: "Closed Leads Review", href: "/dashboard/closed-lead-reviews", icon: CircleCheck, exact: false },
  { group: "Tools", label: "Assignment History", href: "/dashboard/assignment-history", icon: Users, exact: false },
  { group: "Tools", label: "Settings", href: "/dashboard/settings", icon: Settings, exact: false },
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

// Official company logo (public/logo.png, transparent background). The source
// has generous transparent padding, so the sidebar viewport crops that padding
// while keeping the complete wordmark visible inside its fixed bounds.
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

function Navigation({ mobile = false, role, pendingDeletionReviews = 0 }: { mobile?: boolean; role?: string; pendingDeletionReviews?: number }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const items = navigation
    .filter((item) => {
      if (role === "employee") {
        return ["/dashboard", "/dashboard/leads", "/dashboard/attendance", "/dashboard/agents", "/dashboard/daily-report", "/dashboard/calendar", "/dashboard/follow-up-calendar"].includes(item.href);
      }
      if (item.href === "/dashboard/closed-lead-reviews" || item.href === "/dashboard/assignment-history") return role === "admin";
      return true;
    })
    .map((item) => {
      if (role === "employee" && item.href === "/dashboard/daily-report") return { ...item, label: "My Daily Summary", group: "My Work" };
      if (role === "employee" && item.href === "/dashboard/agents") return { ...item, label: "My Profile", group: "My Work" };
      return item;
    });
  const groups = [...new Set(items.map((item) => item.group))].map((group) => ({
    label: group,
    items: items.filter((item) => item.group === group),
  }));

  return (
    <nav aria-label="Workspace" className="space-y-4">
      {groups.map(({ label: group, items: groupItems }) => (
        <section key={group} aria-label={group} className="space-y-1">
          <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{group}</p>
          {groupItems.map(({ label, href, icon: Icon, exact }) => {
            const isActive = isActivePath(pathname, href, exact);
            const link = (
              <Link
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "crm-nav-link flex items-center gap-3 rounded-lg border-l-2 px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-emerald-700",
                  isActive
                    ? "border-emerald-700 bg-emerald-50 text-emerald-950"
                    : "border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-950",
                )}
              >
                <Icon className="crm-nav-icon size-4.5" aria-hidden="true" />
                <span>{label}</span>
                {href === "/dashboard/closed-lead-reviews" && pendingDeletionReviews > 0 && (
                  <span className="ml-auto flex size-2.5 items-center justify-center rounded-full bg-rose-600" title={`${pendingDeletionReviews} pending reviews`}>
                    <span className="sr-only">{pendingDeletionReviews} pending reviews</span>
                  </span>
                )}
              </Link>
            );

            if (role === "employee" && href === "/dashboard/leads") {
              const isTotalLeads = pathname === href && searchParams.get("month") === "all" && !searchParams.get("bucket") && !searchParams.get("work") && !searchParams.get("status");
              const totalLeadsLink = (
                <Link href="/dashboard/leads?month=all" aria-current={isTotalLeads ? "page" : undefined}
                  className={cn("ml-7 mt-1 flex items-center rounded-lg px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-emerald-700",
                    isTotalLeads ? "bg-emerald-50 text-emerald-900" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900")}
                >Total Leads</Link>
              );
              return mobile
                ? <div key={href}><SheetClose>{link}</SheetClose><SheetClose>{totalLeadsLink}</SheetClose></div>
                : <div key={href}>{link}{totalLeadsLink}</div>;
            }
            return mobile ? <SheetClose key={href}>{link}</SheetClose> : <div key={href}>{link}</div>;
          })}
        </section>
      ))}
    </nav>
  );
}

function Sidebar({ profile, pendingDeletionReviews }: { profile: DashboardProfile; pendingDeletionReviews: number }) {
  return (
    <aside className="hidden w-[232px] shrink-0 border-r border-slate-200 bg-white lg:flex lg:flex-col">
      <div className="flex h-[5.5rem] items-center justify-center border-b border-slate-100 px-4">
        <div className="relative h-[76px] w-full max-w-[200px] overflow-hidden">
          <BrandLogo className="h-full w-full object-cover bg-transparent" preload />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-5">
        <Navigation role={profile.role} pendingDeletionReviews={pendingDeletionReviews} />
      </div>
      <div className="border-t border-slate-200 p-3">
        <Link
          href="/dashboard/agents?editProfile=1"
          aria-label="Open and edit your profile"
          className="flex items-center gap-3 rounded-lg p-2.5 transition-colors hover:bg-slate-50"
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

function MobileNavigation({ profile, pendingDeletionReviews }: { profile: DashboardProfile; pendingDeletionReviews: number }) {
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
          <SheetTitle className="flex items-center justify-center">
            <div className="relative h-[76px] w-full max-w-[200px] overflow-hidden">
              <BrandLogo className="h-full w-full object-cover bg-transparent" sizes="200px" />
            </div>
          </SheetTitle>
        </SheetHeader>
        <div className="flex flex-1 flex-col px-4 py-6">
          <Navigation mobile role={profile.role} pendingDeletionReviews={pendingDeletionReviews} />
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

export function DashboardShell({ children, profile, attendanceToday, initialRange, pendingDeletionReviews = 0 }: DashboardShellProps) {
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
      <Sidebar profile={profile} pendingDeletionReviews={pendingDeletionReviews} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
          <div className="flex min-h-[4.25rem] items-center gap-3 px-4 sm:px-6">
            <MobileNavigation profile={profile} pendingDeletionReviews={pendingDeletionReviews} />
            <div className="ml-auto flex items-center gap-2 sm:gap-3">
              {attendanceToday && <AttendanceChip attendance={attendanceToday} />}
              <RealtimeNotifications />
              <GlobalSearch role={profile.role} />
              {profile.role !== "employee" && <Link
                href="/dashboard/tasks"
                aria-label="Tasks"
                className="flex items-center gap-2 rounded-full border border-emerald-900/10 bg-white/70 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 sm:flex"
              >
                <CheckSquare className="size-4" aria-hidden="true" />
                <span className="hidden xl:inline">Tasks</span>
              </Link>}
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
        </header>
        <DashboardDateRangeProvider value={{ range, onChange: handleRangeChange }}>
          <main className="crm-main-content flex-1 p-4 sm:p-6 lg:px-8 lg:py-7">{children}</main>
        </DashboardDateRangeProvider>
        <AssistantChat role={profile.role} />
      </div>
    </div>
  );
}
