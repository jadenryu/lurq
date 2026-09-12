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
    <div className="flex flex-col gap-5" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      {/* PageHeader: title, subtitle, action */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="h-5 w-40 animate-pulse rounded-md bg-muted" />
          <div className="h-4 w-64 animate-pulse rounded-md bg-muted/60" />
        </div>
        <div className="h-9 w-28 animate-pulse rounded-md bg-muted/60" />
      </div>

      {/* Stat strip */}
      {/* Must match StatRow exactly — one bordered band split by hairlines, not
          four gapped boxes. A skeleton that reflows when the content lands reads
          as a layout bug, not as loading. */}
      <div className="grid grid-cols-2 divide-x divide-y divide-edge overflow-hidden rounded-[var(--radius-panel)] border border-edge md:grid-cols-4 md:divide-y-0">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="px-4 py-3.5">
            <div
              className="h-3 w-16 animate-pulse rounded bg-muted/60"
              style={{ animationDelay: `${i * 70}ms` }}
            />
            <div
              className="mt-2.5 h-6 w-20 animate-pulse rounded bg-muted/40"
              style={{ animationDelay: `${i * 70}ms` }}
            />
          </div>
        ))}
      </div>

      {/* Primary panel */}
      <div
        className="h-72 animate-pulse rounded-[var(--radius-panel)] border border-edge bg-muted/25"
        style={{ animationDelay: "280ms" }}
      />
    </div>
  );
}
