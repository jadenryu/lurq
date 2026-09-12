import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Time-range selector for the usage view. Rendered as links so the whole page
 * re-reads server-side for the new window, no client state, and the range is
 * shareable/bookmarkable.
 *
 * It lives in a filter row *above* the cards it scopes rather than inside a chart
 * header: one control row governs everything below it, so the charts can never
 * disagree about which window they're showing.
 */
export const RANGES = [
  { days: 7, label: "7d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
];

export function RangeTabs({ active, basePath }: { active: number; basePath: string }) {
  return (
    // A segmented control, not three loose buttons: one inset track with the
    // selected cell lifted out of it. Three separate outlined pills read as
    // three unrelated actions, which is exactly wrong for a set where picking one
    // un-picks the others.
    <div
      className="inline-flex h-8 items-center gap-0.5 rounded-[var(--radius-control)] border border-edge bg-surface-2 p-0.5"
      role="group"
      aria-label="Time range"
    >
      {RANGES.map((r) => {
        const selected = r.days === active;
        return (
          <Link
            key={r.days}
            href={`${basePath}?days=${r.days}`}
            aria-current={selected ? "true" : undefined}
            className={cn(
              "rounded-[3px] px-2.5 text-[12px] font-medium leading-7 tabular-nums transition-colors",
              selected
                ? "bg-surface text-ink shadow-[0_1px_0_0_var(--edge-lit)]"
                : "text-ink-3 hover:text-ink",
            )}
          >
            {r.label}
          </Link>
        );
      })}
    </div>
  );
}

/** Clamp `?days=` to a supported range so a hand-edited URL can't skew the axis. */
export function parseDays(raw: string | string[] | undefined, fallback = 30): number {
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  return RANGES.some((r) => r.days === value) ? value : fallback;
}
