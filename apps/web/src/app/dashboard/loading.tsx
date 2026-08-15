/**
 * Route-level skeleton for the dashboard.
 *
 * Every dashboard page is a server component that awaits the issuer service, so
 * navigation used to hang on the previous page with no feedback until the fetch
 * resolved. On a cold service that is seconds of a click that looks ignored —
 * which is the other half of "the Dashboard link doesn't work".
 *
 * Shapes, not spinners: the skeleton matches the real header + panel geometry so
 * the swap is a fill rather than a relayout.
 */
export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      {/* PageHeader: title, subtitle, action */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="h-6 w-40 animate-pulse rounded-md bg-muted" />
          <div className="h-4 w-64 animate-pulse rounded-md bg-muted/60" />
        </div>
        <div className="h-9 w-28 animate-pulse rounded-md bg-muted/60" />
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-lg border border-border bg-muted/40"
            style={{ animationDelay: `${i * 70}ms` }}
          />
        ))}
      </div>

      {/* Primary panel */}
      <div
        className="h-64 animate-pulse rounded-lg border border-border bg-muted/30"
        style={{ animationDelay: "280ms" }}
      />
    </div>
  );
}
