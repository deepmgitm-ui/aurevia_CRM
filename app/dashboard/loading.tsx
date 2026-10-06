export default function DashboardLoading() {
  return (
    <div
      role="status"
      aria-label="Loading dashboard page"
      className="mx-auto w-full max-w-7xl space-y-6 p-6"
    >
      <span className="sr-only">Loading page...</span>
      <div className="animate-pulse space-y-3">
        <div className="h-8 w-56 rounded-lg bg-slate-200" />
        <div className="h-4 w-80 max-w-full rounded bg-slate-100" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-white p-5"
          >
            <div className="h-3 w-24 rounded bg-slate-100" />
            <div className="mt-5 h-7 w-16 rounded bg-slate-200" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {Array.from({ length: 2 }, (_, index) => (
          <div
            key={index}
            className="h-72 animate-pulse rounded-2xl border border-slate-200 bg-white p-5"
          >
            <div className="h-4 w-40 rounded bg-slate-200" />
            <div className="mt-6 h-52 rounded-xl bg-slate-50" />
          </div>
        ))}
      </div>
      <div className="h-56 animate-pulse rounded-2xl border border-slate-200 bg-white p-5">
        <div className="h-4 w-36 rounded bg-slate-200" />
        <div className="mt-6 space-y-3">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="h-6 rounded bg-slate-50" />
          ))}
        </div>
      </div>
    </div>
  );
}
