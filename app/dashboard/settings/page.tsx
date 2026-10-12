import { CrmOperationsPanel } from "./crm-operations-panel";
import { getCapacity, getScheduler, getDuplicates, getSchedulerStatus } from "@/app/actions/crm-workflows";
import { createClient } from "@/lib/supabase/server";
import { getAllUsers } from "@/app/actions/users";
import { getMasterData } from "@/app/actions/master-data";

import { AdminUserPanel } from "./admin-user-panel";
import { AutomationPanel } from "./automation-panel";
import { MasterDataPanel } from "./master-data-panel";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase
        .from("profiles")
        .select("name, role")
        .eq("id", user.id)
        .single()
    : { data: null };

  const name = profile?.name?.trim() || user?.email?.split("@")[0] || "User";
  const role = profile?.role ?? "employee";
  const isTeamLead = role === "admin" || role === "manager";
  const [usersResult, masterDataResult, capacity, scheduler, duplicates, schedulerStatus] = await Promise.all([
    role === "admin" ? getAllUsers() : null,
    isTeamLead ? getMasterData() : null,
    role === "admin" ? getCapacity() : null,
    role === "admin" ? getScheduler() : null,
    role === "admin" ? getDuplicates() : null,
    role === "admin" ? getSchedulerStatus() : null,
  ]);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
          Settings
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Manage your CRM profile and account details.
        </p>
      </div>
      <SettingsForm initialName={name} role={role} />
      {role === "admin" && usersResult?.success && (
        <AdminUserPanel initialUsers={usersResult.data} />
      )}
      {isTeamLead && masterDataResult?.success && masterDataResult.data && (
        <MasterDataPanel initial={masterDataResult.data} />
      )}
      {isTeamLead && <AutomationPanel />}
      {role === "admin" && <CrmOperationsPanel schedulerStatus={schedulerStatus} duplicateError={duplicates && !duplicates.success?duplicates.error:undefined} capacity={capacity} scheduler={scheduler} groups={duplicates?.success?duplicates.data.groups:[]} total={duplicates?.success?duplicates.data.total:0}/> }
    </div>
  );
}
