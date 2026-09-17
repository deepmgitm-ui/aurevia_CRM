"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CheckSquare,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Users,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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

interface DashboardProfile {
  name: string;
  role: "admin" | "manager" | "employee";
}

interface DashboardShellProps {
  children: React.ReactNode;
  profile: DashboardProfile;
}

const navigation = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Leads", href: "/dashboard/leads", icon: Users },
  { label: "Tasks", href: "/dashboard/tasks", icon: CheckSquare },
  { label: "Settings", href: "/dashboard/settings", icon: Settings },
] as const;

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function Navigation({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();

  return (
    <nav className="space-y-1">
      {navigation.map(({ label, href, icon: Icon }) => {
        const isActive =
          href === "/dashboard"
            ? pathname === href
            : pathname.startsWith(href);
        const link = (
          <Link
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-slate-900 text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
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
    <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white lg:flex lg:flex-col">
      <div className="flex h-16 items-center border-b border-slate-200 px-6">
        <span className="text-lg font-semibold tracking-tight text-slate-950">Aurevia CRM</span>
      </div>
      <div className="flex-1 px-4 py-6">
        <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Workspace
        </p>
        <Navigation />
      </div>
      <div className="border-t border-slate-200 p-4">
        <div className="flex items-center gap-3 rounded-lg bg-slate-50 p-3">
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
          <SheetTitle>Aurevia CRM</SheetTitle>
        </SheetHeader>
        <div className="flex flex-1 flex-col px-4 py-6">
          <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Workspace
          </p>
          <Navigation mobile />
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

export function DashboardShell({ children, profile }: DashboardShellProps) {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar profile={profile} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6">
          <MobileNavigation profile={profile} />
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
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
        </header>
        <main className="flex-1 bg-slate-50 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
