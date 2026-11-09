import Link from "next/link";
import { redirect } from "next/navigation";

import { getViewer } from "@/app/actions/leads";
import { createClient } from "@/lib/supabase/server";

const PAGE_SIZE = 25;

type ActivityFeedItem = {
  event_key: string;
  lead_id: string | null;
  lead_name: string;
  lead_phone: string;
  actor_id: string | null;
  actor_name: string;
  action_type: string;
  description: string;
  occurred_at: string;
};

function activityHref(view: "mine" | "all", page: number) {
  const params = new URLSearchParams({ view });
  if (page > 1) params.set("page", String(page));
  return `/dashboard/activity?${params.toString()}`;
}

function activityTone(action: string) {
  if (action.toLowerCase().includes("status")) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (action.toLowerCase().includes("call")) return "border-sky-200 bg-sky-50 text-sky-800";
  if (action.toLowerCase().includes("assignment") || action.toLowerCase().includes("transfer")) return "border-indigo-200 bg-indigo-50 text-indigo-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[]; page?: string | string[] }>;
}) {
  const viewer = await getViewer();
  if (!viewer.success || !["admin", "manager"].includes(viewer.data?.role ?? "")) redirect("/dashboard");

  const params = await searchParams;
  const view = params.view === "all" ? "all" : "mine";
  const requestedPage = Number(typeof params.page === "string" ? params.page : "1");
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 4000) : 1;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crm_activity_feed", {
    p_scope: view,
    p_limit: PAGE_SIZE + 1,
    p_offset: (page - 1) * PAGE_SIZE,
  });
  const rows = (data ?? []) as ActivityFeedItem[];
  const hasNextPage = rows.length > PAGE_SIZE;
  const events = rows.slice(0, PAGE_SIZE);
  const dateFormat = new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 p-5 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">Recently Active</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          See your updates and your team’s recent lead work, notes, calls and assignment changes.
        </p>
      </header>

      <nav aria-label="Activity views" className="grid w-full max-w-md grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-white p-1">
        <Link
          href={activityHref("mine", 1)}
          aria-current={view === "mine" ? "page" : undefined}
          className={`rounded-lg px-2 py-2 text-center text-sm font-medium focus-visible:outline-2 focus-visible:outline-emerald-700 sm:px-4 ${view === "mine" ? "bg-emerald-700 text-white" : "text-slate-600 hover:bg-emerald-50 hover:text-emerald-900"}`}
        >
          My Updates
        </Link>
        <Link
          href={activityHref("all", 1)}
          aria-current={view === "all" ? "page" : undefined}
          className={`rounded-lg px-2 py-2 text-center text-sm font-medium focus-visible:outline-2 focus-visible:outline-emerald-700 sm:px-4 ${view === "all" ? "bg-emerald-700 text-white" : "text-slate-600 hover:bg-emerald-50 hover:text-emerald-900"}`}
        >
          Updates from the Team
        </Link>
      </nav>

      <section aria-label={view === "mine" ? "My Updates" : "Updates from the Team"} className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{view === "mine" ? "My recent updates" : "Updates from the team"}</h2>
          <p className="mt-1 text-sm text-slate-500">
            {view === "mine" ? "Only changes recorded under your account appear here." : "See lead changes and assignment updates recorded across the team."}
          </p>
        </div>

        {error ? (
          <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            Activity could not be loaded. Refresh the page to try again.
          </p>
        ) : events.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
            <p className="font-medium text-slate-900">No activity on this page yet.</p>
            <p className="mt-2 text-sm text-slate-500">
              {view === "mine" ? "Your lead updates, notes and calls will appear here." : "Your team’s lead updates, notes, calls and assignments will appear here."}
            </p>
            {view === "mine" && <Link href="/dashboard/leads" className="mt-4 inline-flex rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-emerald-700">Open leads</Link>}
          </div>
        ) : (
          <ol className="space-y-3">
            {events.map((event) => {
              const searchTerm = event.lead_phone && event.lead_phone !== "-" ? event.lead_phone : event.lead_name;
              const leadHref = event.lead_id
                ? `/dashboard/leads?q=${encodeURIComponent(searchTerm)}&openLead=${encodeURIComponent(event.lead_id)}`
                : null;
              return (
                <li key={event.event_key} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                  <article className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className={`inline-flex max-w-full rounded-full border px-2.5 py-1 text-xs font-semibold ${activityTone(event.action_type)}`}>
                        {event.action_type}
                      </span>
                      <time dateTime={event.occurred_at} className="text-xs tabular-nums text-slate-500">
                        {dateFormat.format(new Date(event.occurred_at))}
                      </time>
                    </div>
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                      {leadHref ? (
                        <Link href={leadHref} className="break-words font-semibold text-slate-950 underline decoration-emerald-300 underline-offset-4 hover:text-emerald-800 focus-visible:outline-2 focus-visible:outline-emerald-700">
                          {event.lead_name || "Unavailable lead"}
                        </Link>
                      ) : <span className="font-semibold text-slate-950">{event.lead_name || "Unavailable lead"}</span>}
                      <span className="text-xs text-slate-500">{event.lead_phone || "No phone"}</span>
                      <span className="text-xs text-slate-500">· by {event.actor_name || "Team member"}</span>
                    </div>
                    {(event.description || "Activity recorded.").length > 280 ? (
                      <details className="text-sm text-slate-700">
                        <summary className="cursor-pointer break-words rounded-sm leading-6 focus-visible:outline-2 focus-visible:outline-emerald-700">
                          {(event.description || "Activity recorded.").slice(0, 280)}… <span className="font-medium text-emerald-800">Show full details</span>
                        </summary>
                        <p className="mt-2 break-words whitespace-pre-wrap leading-6">{event.description}</p>
                      </details>
                    ) : (
                      <p className="break-words whitespace-pre-wrap text-sm leading-6 text-slate-700">{event.description || "Activity recorded."}</p>
                    )}
                  </article>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {!error && events.length > 0 && (
        <nav aria-label="Activity pages" className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
          {page > 1 ? <Link href={activityHref(view, page - 1)} className="font-medium text-emerald-800 hover:underline focus-visible:outline-2 focus-visible:outline-emerald-700">Previous</Link> : <span />}
          <span className="text-slate-500">Page {page.toLocaleString("en-IN")}</span>
          {hasNextPage ? <Link href={activityHref(view, page + 1)} className="font-medium text-emerald-800 hover:underline focus-visible:outline-2 focus-visible:outline-emerald-700">Next</Link> : <span />}
        </nav>
      )}
    </main>
  );
}
