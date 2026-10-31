import {
  BarChart3,
  CalendarDays,
  CheckSquare,
  CircleCheck,
  History,
  Kanban,
  LayoutDashboard,
  Megaphone,
  Settings,
  Stethoscope,
  UserCheck,
  UserCog,
  UserRound,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type DashboardRole = "admin" | "manager" | "employee";
type NavigationSurface = "sidebar" | "search";

interface DashboardDestination {
  group: string;
  label: string;
  searchLabel?: string;
  employeeLabel?: string;
  employeeSearchLabel?: string;
  employeeGroup?: string;
  href: string;
  icon: LucideIcon;
  exact: boolean;
  roles: readonly DashboardRole[];
  surfaces: readonly NavigationSurface[];
}

const teamRoles = ["admin", "manager"] as const;
const allRoles = ["admin", "manager", "employee"] as const;

// Keep the sidebar and quick search backed by one role-aware route registry.
const destinations: readonly DashboardDestination[] = [
  { group: "Overview", label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, exact: true, roles: allRoles, surfaces: ["sidebar", "search"] },
  { group: "Leads & Follow-ups", label: "Follow-ups", href: "/dashboard/tasks", icon: CheckSquare, exact: false, roles: teamRoles, surfaces: ["sidebar", "search"] },
  { group: "Leads & Follow-ups", label: "Leads", href: "/dashboard/leads", icon: Users, exact: false, roles: allRoles, surfaces: ["sidebar", "search"] },
  { group: "Leads & Follow-ups", label: "Pipeline Board", href: "/dashboard/board", icon: Kanban, exact: false, roles: teamRoles, surfaces: ["sidebar", "search"] },
  { group: "Clinic", label: "Attendance", href: "/dashboard/attendance", icon: UserCheck, exact: false, roles: allRoles, surfaces: ["sidebar", "search"] },
  { group: "Clinic", label: "Upcoming Appointments", searchLabel: "Calendar", href: "/dashboard/calendar", icon: CalendarDays, exact: false, roles: allRoles, surfaces: ["sidebar", "search"] },
  { group: "Leads & Follow-ups", label: "Follow-up Calendar", href: "/dashboard/follow-up-calendar", icon: CalendarDays, exact: false, roles: allRoles, surfaces: ["sidebar", "search"] },
  { group: "Clinic", label: "Consultations", href: "/dashboard/consultations", icon: CalendarDays, exact: false, roles: teamRoles, surfaces: ["sidebar", "search"] },
  { group: "Clinic", label: "Surgeries", href: "/dashboard/surgeries", icon: Stethoscope, exact: false, roles: teamRoles, surfaces: ["sidebar", "search"] },
  { group: "Analytics", label: "Lead Analysis", href: "/dashboard/lead-analysis", icon: BarChart3, exact: false, roles: teamRoles, surfaces: ["sidebar", "search"] },
  { group: "Analytics", label: "Source Analysis", href: "/dashboard/source-analysis", icon: Megaphone, exact: false, roles: teamRoles, surfaces: ["sidebar", "search"] },
  { group: "Analytics", label: "City Analysis", href: "/dashboard/city-analysis", icon: CalendarDays, exact: false, roles: teamRoles, surfaces: ["sidebar", "search"] },
  { group: "Analytics", label: "Agents Performance", searchLabel: "Agents", employeeLabel: "My Profile", employeeSearchLabel: "Agents", employeeGroup: "My Work", href: "/dashboard/agents", icon: UserCog, exact: false, roles: allRoles, surfaces: ["sidebar", "search"] },
  { group: "Analytics", label: "Daily Team Report", employeeLabel: "My Daily Summary", employeeSearchLabel: "My Daily Summary", employeeGroup: "My Work", href: "/dashboard/daily-report", icon: BarChart3, exact: false, roles: allRoles, surfaces: ["sidebar", "search"] },
  { group: "Analytics", label: "Reports", href: "/dashboard/reports", icon: BarChart3, exact: false, roles: teamRoles, surfaces: ["sidebar", "search"] },
  { group: "Tools", label: "Marketing", href: "/dashboard/marketing", icon: Megaphone, exact: false, roles: teamRoles, surfaces: ["sidebar", "search"] },
  { group: "Tools", label: "Closed Leads Review", href: "/dashboard/closed-lead-reviews", icon: CircleCheck, exact: false, roles: ["admin"], surfaces: ["sidebar", "search"] },
  { group: "Tools", label: "Assignment History", href: "/dashboard/assignment-history", icon: History, exact: false, roles: ["admin"], surfaces: ["sidebar", "search"] },
  { group: "Tools", label: "Settings", href: "/dashboard/settings", icon: Settings, exact: false, roles: teamRoles, surfaces: ["sidebar", "search"] },
  { group: "Clinic", label: "Patients", href: "/dashboard/patients", icon: UserRound, exact: false, roles: teamRoles, surfaces: ["search"] },
];

export function getDashboardDestinations(role: DashboardRole, surface: NavigationSurface) {
  return destinations
    .filter((destination) => destination.surfaces.includes(surface) && destination.roles.includes(role))
    .map((destination) => ({
      ...destination,
      label: surface === "search"
        ? role === "employee"
          ? destination.employeeSearchLabel ?? destination.searchLabel ?? destination.label
          : destination.searchLabel ?? destination.label
        : role === "employee" ? destination.employeeLabel ?? destination.label : destination.label,
      group: role === "employee" ? destination.employeeGroup ?? destination.group : destination.group,
    }));
}
