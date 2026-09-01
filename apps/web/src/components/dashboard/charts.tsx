"use client";

import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { fmtDay } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Chart primitives for the dashboard.
 *
 * Every plot here is a **single series** drawn in one ink, the `signal` accent
 * (periwinkle) from the shared syntax palette. One hue means there is no
 * categorical palette to validate and no legend to draw: the card's eyebrow
 * already names what's plotted. Identity in the per-tool breakdown is carried by
 * a text label, never by cycling hues, and never by a darker-where-bigger ramp
 * (that would double-encode bar length as color).
 *
 * The status hues (ok/bad/warn) are reserved for state chips and deliberately
 * never appear as a data mark, so a colored bar can't be misread as a verdict.
 *
 * Fixed mark specs, applied consistently: bars cap at 24px and never fill their
 * slot, the data-end is 4px-rounded while the baseline stays square, touching
 * bars are separated by a 2px surface gap rather than a stroke, axes are solid
 * 1px hairlines (never dashed), and every plot ships a hover layer plus a
 * table-view twin so no value is reachable only by pointer.
 */

export interface Point {
  date: string;
  count: number;
}

const axisText = "font-mono text-[0.65rem] tabular-nums text-ink-3";

// ── column chart (magnitude over time, one series) ──────────────────────────

/**
 * Daily volume. Expects a **gap-free** series (one point per day in the window,
 * zero-count days included), `getUsageSummary` guarantees that DB-side. A
 * series carrying only days-with-traffic would give equal-width bars unequal
 * time spans and misstate the trend.
 */
export function ColumnChart({
  data,
  height = 152,
  unit = "call",
}: {
  data: Point[];
  height?: number;
  unit?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...data.map((p) => p.count), 1);
  const n = data.length;
  const active = hover === null ? null : data[hover];

  return (
    <div>
      <div className="relative">
        {/* Tooltip: enhances, never gates, the same numbers live in the table twin
            below. Clamped away from the edges so it can't overflow the card. */}
        {active && hover !== null && (
          <div
            // bg-popover, not bg-background: this floats over a panel, and
            // --background is the page ground (darker than the panel it would
            // be sitting on). --popover is the room's raised inset step.
            className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-[var(--radius-control)] border border-border bg-popover px-2.5 py-1.5 shadow-lg"
            style={{ left: `${Math.min(Math.max(((hover + 0.5) / n) * 100, 9), 91)}%` }}
          >
            <p className="font-mono text-[0.7rem] tabular-nums text-foreground">
              {active.count.toLocaleString()} {unit}
              {active.count === 1 ? "" : "s"}
            </p>
            <p className={cn(axisText, "mt-0.5")}>{fmtDay(active.date)}</p>
          </div>
        )}

        <div
          className="flex items-end gap-[2px]"
          style={{ height }}
          onMouseLeave={() => setHover(null)}
        >
          {data.map((p, i) => {
            const pct = (p.count / max) * 100;
            const dim = hover !== null && hover !== i;
            return (
              // Full-height hit area: the pointer never has to land on a 3px bar.
              <div
                key={p.date}
                className="flex h-full flex-1 items-end justify-center"
                onMouseEnter={() => setHover(i)}
              >
                {p.count === 0 ? (
                  <div className="h-px w-full max-w-[24px] bg-signal/25" />
                ) : (
                  <div
                    className="w-full max-w-[24px] rounded-t-[4px] bg-signal transition-opacity duration-100"
                    style={{ height: `${Math.max(pct, 1.5)}%`, opacity: dim ? 0.3 : 1 }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Solid hairline baseline, never dashed. */}
      <div className="h-px w-full bg-border" />

      {n > 1 && (
        <div className="mt-2 flex justify-between">
          <span className={axisText}>{fmtDay(data[0]!.date)}</span>
          <span className={axisText}>{fmtDay(data[n - 1]!.date)}</span>
        </div>
      )}
    </div>
  );
}

// ── sparkline (trend, secondary) ────────────────────────────────────────────

/** Compact trend line with an end marker. Strokes stay 2px at any scale. */
export function Sparkline({ data, height = 40 }: { data: Point[]; height?: number }) {
  const gradientId = useId();
  if (data.length < 2) return <div style={{ height }} />;

  const W = 200;
  const H = 48;
  const pad = 4;
  const max = Math.max(...data.map((p) => p.count), 1);
  const x = (i: number) => pad + (i / (data.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);

  const line = data.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.count)}`).join(" ");
  const area = `${line} L${x(data.length - 1)},${H} L${x(0)},${H} Z`;
  const last = data[data.length - 1]!;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ height }}
      className="w-full text-signal"
      role="img"
      aria-label={`Trend, ending at ${last.count.toLocaleString()}`}
    >
      <defs>
        {/* Area is a ~10% wash, never a saturated block. */}
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity={0.16} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* End marker with a 2px surface ring so it stays legible over the line.
          The ring has to be the panel it is drawn on (--card), not --background:
          that is the page ground and would punch a hole darker than the panel. */}
      <circle
        cx={x(data.length - 1)}
        cy={y(last.count)}
        r={4}
        fill="currentColor"
        stroke="var(--card)"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// ── horizontal bar list (magnitude by nominal category) ─────────────────────

/**
 * Per-category totals. One ink for every row, the label carries identity, so a
 * darker-where-bigger ramp would burn the color channel on information the bar
 * length already shows.
 */
/** One row of a BarList. `href` is optional — a row without one stays inert. */
export interface BarItem {
  label: string;
  count: number;
  href?: string;
}

export function BarList({
  items,
  layout = "inline",
}: {
  items: BarItem[];
  /**
   * `inline` puts label · bar · value on one row, only legible in a wide column.
   * `stacked` lifts label and value above a full-width bar, for narrow rails where
   * an inline track collapses to a stub that reads as "no data".
   */
  layout?: "inline" | "stacked";
}) {
  const max = Math.max(...items.map((t) => t.count), 1);
  const label = "font-mono text-xs lowercase tracking-wide text-muted-foreground";
  /**
   * A row becomes a link when the caller gives it somewhere to go. Kept as a
   * wrapper rather than a prop on the label so the whole row — bar included —
   * is the hit target: a 24px-wide truncated label is not a click target anyone
   * should be asked to hit.
   */
  const Row = ({ item, children }: { item: BarItem; children: ReactNode }) =>
    item.href ? (
      <Link
        href={item.href}
        className="group block rounded-[var(--radius-chip)] outline-none transition-colors hover:bg-surface-2/60 focus-visible:ring-2 focus-visible:ring-signal/50"
      >
        {children}
      </Link>
    ) : (
      <div className="group">{children}</div>
    );
  const value = "font-mono text-xs tabular-nums text-foreground";

  // Direct value labels on every row are fine here: the list is short and sorted,
  // so this is a labelled ranking rather than a plot flooded with numbers.
  if (layout === "stacked") {
    return (
      <div className="space-y-3">
        {items.map((t) => (
          <Row key={t.label} item={t}>
            <div className="flex items-baseline justify-between gap-2">
              <span className={label}>{t.label}</span>
              <span className={value}>{t.count.toLocaleString()}</span>
            </div>
            {/* Opaque --muted (= the room's --surface-2, its "inset rows" step),
                not --muted/50. Half-strength over a panel that is now only one
                ramp step below it leaves a track you cannot see. */}
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-sm bg-muted">
              <div
                className="h-full rounded-r-[4px] bg-signal/80 transition-[width] duration-300 group-hover:bg-signal"
                style={{ width: `${Math.max((t.count / max) * 100, 1)}%` }}
              />
            </div>
          </Row>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {items.map((t) => (
        <Row key={t.label} item={t}>
          <div className="flex items-center gap-3">
          <span className={cn("w-24 shrink-0 truncate", label)} title={t.label}>
            {t.label}
          </span>
          <div className="h-2.5 flex-1 overflow-hidden rounded-sm bg-muted">
            <div
              className="h-full rounded-r-[4px] bg-signal/80 transition-[width] duration-300 group-hover:bg-signal"
              style={{ width: `${Math.max((t.count / max) * 100, 1)}%` }}
            />
          </div>
          <span className={cn("w-14 shrink-0 text-right", value)}>
            {t.count.toLocaleString()}
          </span>
          </div>
        </Row>
      ))}
    </div>
  );
}

// ── meter ───────────────────────────────────────────────────────────────────

/** Single proportion. Track is a lighter step of the same ink as the fill. */
export function Meter({ value, max, caption }: { value: number; max: number; caption?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-signal/15">
        <div className="h-full rounded-full bg-signal/80" style={{ width: `${pct}%` }} />
      </div>
      {caption && <p className={cn(axisText, "mt-2")}>{caption}</p>}
    </div>
  );
}

// ── table twin ──────────────────────────────────────────────────────────────

/**
 * The WCAG-clean equivalent of a plot. Collapsed by default so it doesn't compete
 * with the chart, but it means no value is pointer-only.
 */
export function ChartValues({
  rows,
  columns,
}: {
  rows: (string | number)[][];
  columns: [string, string];
}) {
  return (
    <details className="group mt-4">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 font-mono text-[0.65rem] uppercase tracking-[0.16em] text-ink-3 transition-colors hover:text-foreground">
        <span className="transition-transform group-open:rotate-90">›</span>
        values
      </summary>
      <div className="mt-3 max-h-56 overflow-y-auto rounded-[var(--radius-control)] border border-border">
        <table className="w-full text-left">
          <thead className="sticky top-0 bg-card">
            <tr className="border-b border-border">
              {columns.map((c) => (
                <th
                  key={c}
                  className="px-3 py-2 font-mono text-[0.65rem] font-normal uppercase tracking-wide text-ink-3"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-border/50 last:border-0">
                {r.map((cell, j) => (
                  <td
                    key={j}
                    className={cn(
                      "px-3 py-1.5 font-mono text-xs",
                      j === 0 ? "text-muted-foreground" : "tabular-nums text-foreground",
                    )}
                  >
                    {typeof cell === "number" ? cell.toLocaleString() : cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
