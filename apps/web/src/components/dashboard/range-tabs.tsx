import { SegmentedLinks } from "@/components/dashboard/segmented";

/**
 * Time-range selector, rendered in the header of the chart it scopes.
 *
 * In the chart rather than in a page header or a preferences page, because
 * that is where the reader is looking when they want a different window. It is
 * still a URL param, so every card on the page reads the same `?days=` and none
 * of them can disagree about which window they are showing.
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
