import { redirect } from "next/navigation";

import { markMyAttendance } from "@/app/actions/attendance";
import { getDashboardWindow } from "@/app/actions/leads";
import { DashboardShell } from "./dashboard-shell";
import { createClient, getUserSafely } from "@/lib/supabase/server";

const roles = ["admin", "manager", "employee"] as const;
type UserRole = (typeof roles)[number];

function isUserRole(value: string): value is UserRole {
  return roles.includes(value as UserRole);
}

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createClient();
  // Never throws: an invalid/expired refresh token resolves to `user: null`,
  // so this guard redirects cleanly instead of crashing the whole /dashboard
  // subtree (which previously surfaced as a 404/error page).
  const { user } = await getUserSafely(supabase);

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("name, role")
    .eq("id", user.id)
    .single();

  const profileName = profile?.name?.trim() || user.email?.split("@")[0] || "User";
  const profileRole = profile?.role && isUserRole(profile.role) ? profile.role : "employee";

  // Signing in IS the check-in. It runs on every dashboard request, but it now
  // reads first and only writes when the day has no mark yet — and the profile
  // is handed in, because this function would otherwise look the SAME row up a
  // second time on every page load.
  const [attendance, window] = await Promise.all([
    markMyAttendance({ id: user.id, role: profileRole }),
    getDashboardWindow(),
  ]);
  if (!attendance.success) {
    console.warn("[attendance] Could not record the check-in:", attendance.error);
  }

  return (
    <DashboardShell
      profile={{ name: profileName, role: profileRole }}
      attendanceToday={attendance.success ? attendance.data : null}
      initialRange={window.range}
    >
      {children}
    </DashboardShell>
  );
}
