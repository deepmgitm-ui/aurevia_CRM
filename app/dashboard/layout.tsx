import { redirect } from "next/navigation";
import { Suspense } from "react";

import { markMyAttendance } from "@/app/actions/attendance";
import type { Metadata } from "next";
import { getDashboardWindow } from "@/app/actions/leads";
import { getPendingDeletionReviewCount } from "@/app/actions/deletion-reviews";
import { DashboardShell } from "./dashboard-shell";
import { createClient, getUserSafely } from "@/lib/supabase/server";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  robots: { index: false, follow: false, noarchive: true },
};

const roles = ["admin", "manager", "employee"] as const;
type UserRole = (typeof roles)[number];

function isUserRole(value: string): value is UserRole {
  return roles.includes(value as UserRole);
}

function DashboardShellFallback() {
  return (
    <div className="flex min-h-screen animate-pulse bg-slate-50">
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white p-5 lg:block">
        <div className="h-10 w-36 rounded-lg bg-slate-200" />
        <div className="mt-10 space-y-3">
          {Array.from({ length: 9 }, (_, index) => (
            <div key={index} className="h-10 rounded-lg bg-slate-100" />
          ))}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="h-16 border-b border-slate-200 bg-white" />
        <main className="flex-1 space-y-5 p-4 sm:p-6 lg:p-8">
          <div className="h-8 w-56 rounded-lg bg-slate-200" />
          <div className="h-4 w-80 max-w-full rounded bg-slate-100" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="h-28 rounded-2xl border border-slate-200 bg-white" />
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {Array.from({ length: 2 }, (_, index) => (
              <div key={index} className="h-72 rounded-2xl border border-slate-200 bg-white" />
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}

async function DashboardShellData({
  userId,
  email,
  children,
}: {
  userId: string;
  email: string | null;
  children: ReactNode;
}) {
  const supabase = await createClient();
  const [profileResult, privateProfileResult] = await Promise.all([
    supabase.from("profiles").select("name, role").eq("id", userId).single(),
    supabase.from("employee_private_profiles").select("photo_url").eq("id", userId).maybeSingle(),
  ]);
  const { data: profile, error: profileError } = profileResult;
  const profileNameValue = profile?.name;
  const profileRoleValue = profile?.role;
  if (profileError) console.error("[dashboard] Unable to load the signed-in profile:", profileError.message);

  const { data: privateProfile, error: privateProfileError } = privateProfileResult;
  let photoUrl = typeof privateProfile?.photo_url === "string" ? privateProfile.photo_url : null;
  if (privateProfileError && /employee_private_profiles|relation .* does not exist|could not find the table/i.test(privateProfileError.message)) {
    // Compatibility while the additive privacy migration is being rolled out.
    const legacyProfile = await supabase.from("profiles").select("photo_url").eq("id", userId).maybeSingle();
    photoUrl = typeof legacyProfile.data?.photo_url === "string" ? legacyProfile.data.photo_url : null;
  } else if (privateProfileError) {
    console.error("[dashboard] Unable to load the profile photo:", privateProfileError.message);
  }

  const profileName = profileNameValue?.trim() || email?.split("@")[0] || "User";
  const profileRole = profileRoleValue && isUserRole(profileRoleValue) ? profileRoleValue : "employee";

  // Keep sign-in marking idempotent, but do not block the loading shell while
  // the check-in and date-window data resolve.
  const [attendance, window, pendingDeletionReviews] = await Promise.all([
    markMyAttendance({ id: userId, role: profileRole }),
    profileRole === "employee" ? Promise.resolve(null) : getDashboardWindow(),
    profileRole === "admin" ? getPendingDeletionReviewCount() : Promise.resolve(0),
  ]);
  if (!attendance.success) {
    console.warn("[attendance] Could not record the check-in:", attendance.error);
  }

  return (
    <DashboardShell
      profile={{
        name: profileName,
        role: profileRole,
        photo_url: photoUrl,
      }}
      attendanceToday={attendance.success ? attendance.data : null}
      initialRange={window?.range}
      pendingDeletionReviews={pendingDeletionReviews}
    >
      {children}
    </DashboardShell>
  );
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

  return (
    <Suspense fallback={<DashboardShellFallback />}>
      <DashboardShellData userId={user.id} email={user.email ?? null}>
        {children}
      </DashboardShellData>
    </Suspense>
  );
}
