import Link from "next/link";
import { redirect } from "next/navigation";

import { getViewer } from "@/app/actions/leads";
import { createClient } from "@/lib/supabase/server";

const PAGE_SIZE = 50;

export default async function AssignmentHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const viewer = await getViewer();
  if (!viewer.success || viewer.data?.role !== "admin") redirect("/dashboard");

  const params = await searchParams;
  const requestedPage = Number(params.page ?? "1");
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 10000) : 1;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crm_assignment_events")
    .select("id, lead_id, actor_id, assigned_to, assigned_at, previous_assigned_to, event_kind")
    .order("assigned_at", { ascending: false })
    .order("id", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const events = (data ?? []).slice(0, PAGE_SIZE);
  const leadIds = [...new Set(events.map((event) => event.lead_id).filter(Boolean))];
  const actorIds = [...new Set(events.map((event) => event.actor_id).filter(Boolean))] as string[];
  const [leadResult, actorResult] = await Promise.all([
    leadIds.length ? supabase.from("leads").select("id, name").in("id", leadIds) : Promise.resolve({ data: [], error: null }),
    actorIds.length ? supabase.from("profiles").select("id, name").in("id", actorIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const leadNames = new Map((leadResult.data ?? []).map((lead) => [lead.id, lead.name]));
  const actorNames = new Map((actorResult.data ?? []).map((actor) => [actor.id, actor.name]));
  const dateFormat = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Assignment History</h1>
        <p className="mt-2 text-sm text-slate-500">Review when leads were assigned or transferred, who made the change, and the receiving team member.</p>
        <p className="mt-1 text-xs text-slate-500">Previous owner and action type are recorded for new events. Older entries may not include them. Deleted leads and their history follow the existing deletion rules.</p>
      </div>
      {error ? (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">Unable to load assignment history. Please try again.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {(leadResult.error || actorResult.error) && <p role="alert" className="border-b border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Some names could not be loaded. Refresh to try again.</p>}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Date &amp; time</th><th className="px-4 py-3">Lead</th><th className="px-4 py-3">Action</th><th className="px-4 py-3">From</th><th className="px-4 py-3">To</th><th className="px-4 py-3">Changed by</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {events.map((event) => <tr key={event.id}><td className="px-4 py-3 text-slate-600">{dateFormat.format(new Date(event.assigned_at))}</td><td className="px-4 py-3 font-medium text-slate-900">{leadNames.get(event.lead_id) || "Unavailable"}</td><td className="px-4 py-3 text-slate-700">{event.event_kind === "transfer" ? "Transfer" : event.event_kind === "assignment" ? "Assignment" : "Not recorded"}</td><td className="px-4 py-3 text-slate-700">{event.previous_assigned_to || (event.event_kind === "assignment" ? "Unassigned" : "Not recorded")}</td><td className="px-4 py-3 text-slate-700">{event.assigned_to || "Unavailable"}</td><td className="px-4 py-3 text-slate-700">{event.actor_id ? actorNames.get(event.actor_id) || "Unavailable" : "System / unavailable"}</td></tr>)}
              </tbody>
            </table>
          </div>
          {events.length === 0 && <p className="p-6 text-sm text-slate-500">No assignment records on this page.</p>}
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm">
            {page > 1 ? <Link className="text-emerald-700 hover:underline" href={`/dashboard/assignment-history?page=${page - 1}`}>Previous</Link> : <span />}
            <span className="text-slate-500">Page {page}</span>
            {(data?.length ?? 0) > PAGE_SIZE && page < 10000 ? <Link className="text-emerald-700 hover:underline" href={`/dashboard/assignment-history?page=${page + 1}`}>Next</Link> : <span />}
          </div>
        </div>
      )}
    </div>
  );
}
