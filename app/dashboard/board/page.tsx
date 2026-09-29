import { getPipelineBoard, getViewer } from "@/app/actions/leads";

import { PipelineBoard } from "./pipeline-board";

export const metadata = {
  title: "Pipeline Board · Aurevia CRM",
  description: "The whole pipeline at a glance: drag a lead from one stage to the next.",
};

export default async function BoardPage() {
  const [boardResult, viewerResult] = await Promise.all([getPipelineBoard(), getViewer()]);
  const viewer = viewerResult.success ? viewerResult.data : null;

  return (
    <div className="mx-auto w-full max-w-[110rem] space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">Pipeline Board</h1>
        <p className="mt-2 text-sm text-slate-500">
          Every lead, grouped by stage. Drag a card to move it, tap it for the full record.
        </p>
      </div>

      {!boardResult.success ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          The board could not be loaded: {boardResult.error}
        </div>
      ) : boardResult.data.total === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-sm font-medium text-slate-900">No leads on the board yet</p>
          <p className="mt-1 text-sm text-slate-500">
            Import your spreadsheet from the Leads page and every column fills up automatically.
          </p>
        </div>
      ) : (
        <PipelineBoard initialData={boardResult.data} role={viewer?.role ?? "employee"} />
      )}
    </div>
  );
}
