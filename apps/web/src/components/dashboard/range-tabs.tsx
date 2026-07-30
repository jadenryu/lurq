import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Time-range selector for the usage view. Rendered as links so the whole page
 * re-reads server-side for the new window — no client state, and the range is
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
    <div
      className="flex items-center gap-1.5"
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
              "h-9 rounded-[var(--radius-control)] border px-3 font-mono text-xs leading-9 transition-colors",
              selected
                ? "border-signal/45 bg-signal/10 text-foreground"
                : "border-border text-muted-foreground hover:text-foreground",
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
