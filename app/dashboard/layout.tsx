import { redirect } from "next/navigation";

import { DashboardShell } from "./dashboard-shell";
import { createClient } from "@/lib/supabase/server";

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
  const {
    data: { user },
  } = await supabase.auth.getUser();

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

  return (
    <DashboardShell profile={{ name: profileName, role: profileRole }}>
      {children}
    </DashboardShell>
  );
}
