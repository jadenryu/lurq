import { SegmentedLinks } from "@/components/dashboard/segmented";

/**
 * Time-range selector for the usage view.
 *
 * It lives in a filter row *above* the cards it scopes rather than inside a
 * chart header: one control row governs everything below it, so the charts can
 * never disagree about which window they're showing.
 *
 * The control itself is `SegmentedLinks` — shared with the audit log's range and
 * styled once in segmented.tsx, so the two can't drift apart.
 */
export const RANGES = [
  { days: 7, label: "7d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
];

export function RangeTabs({ active, basePath }: { active: number; basePath: string }) {
  return (
    <SegmentedLinks
      label="Time range"
      active={active}
      options={RANGES.map((r) => ({
        value: r.days,
        label: r.label,
        href: `${basePath}?days=${r.days}`,
      }))}
    />
  );
}

/** Clamp `?days=` to a supported range so a hand-edited URL can't skew the axis. */
export function parseDays(raw: string | string[] | undefined, fallback = 30): number {
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  return RANGES.some((r) => r.days === value) ? value : fallback;
}
