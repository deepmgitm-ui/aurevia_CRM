import { createClient } from "@/lib/supabase/server";
import { TaskCenter, type TaskLead } from "./task-center";

export default async function TasksPage() {
  const supabase = await createClient();
  const { data: leads, error } = await supabase
    .from("leads")
    .select("id, name, phone, disease, follow_up_date, status, temperature, assigned_to, source, remarks")
    .not("follow_up_date", "is", null)
    .neq("follow_up_date", "")
    .neq("follow_up_date", "-")
    .order("follow_up_date", { ascending: true })
    .limit(500);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">Task Center</h1>
        <p className="mt-2 text-sm text-slate-500">
          Prioritize follow-ups, log calls, and keep every next action visible.
        </p>
      </div>
      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          Unable to load follow-ups: {error.message}
        </div>
      ) : (
        <TaskCenter leads={(leads ?? []) as TaskLead[]} />
      )}
    </div>
  );
}
