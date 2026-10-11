export default function CalendarLoading() {
  return (
    <div role="status" className="mx-auto max-w-7xl animate-pulse space-y-6 p-4 sm:p-6">
      <span className="sr-only">Loading upcoming appointments...</span>
      <div className="h-8 w-72 max-w-full rounded-lg bg-slate-200" />
      <div className="h-64 rounded-2xl border border-slate-200 bg-white" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="h-96 rounded-2xl border border-slate-200 bg-white" />
        <div className="h-64 rounded-2xl border border-slate-200 bg-white" />
      </div>
    </div>
  );
}
