"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import { microLabel } from "@/components/dashboard/panel";
import { cn } from "@/lib/utils";

/**
 * The metric strip: one bordered band split by hairlines, and — where the caller
 * supplies it — a drawer that opens underneath with the evidence behind whichever
 * number you clicked.
 *
 * Four separate cards say "four unrelated objects". One divided strip says "four
 * readings off the same instrument", which is what they are.
 *
 * The drill-down is the part that makes it an instrument rather than a poster.
 * A dashboard that answers "is everything okay?" and then has nothing to say when
 * the answer is no has stopped halfway: every console worth copying leads with a
 * calm number and keeps the detail one click behind it — progressive disclosure,
 * not a second page. The drawer opens *inside the strip*, full width, so the
 * other three numbers stay on screen while you read one of them. That is the
 * whole reason it isn't a modal: the question a metric raises is almost always
 * comparative.
 */

interface TileProps {
  label: string;
  value: string | number;
  hint?: string;
  /** Period-over-period change, already computed. See `Delta`. */
  delta?: ReactNode;
  trend?: ReactNode;
  href?: string;
  /** What this number is made of. Its presence is what makes the tile openable. */
  detail?: ReactNode;
  /** Injected by StatRow. Not part of the public shape. */
  _index?: number;
  _open?: boolean;
  _panelId?: string;
  _onToggle?: () => void;
}

export function StatRow({ children }: { children: ReactNode }) {
  const tiles = Children.toArray(children).filter(isValidElement) as ReactElement<TileProps>[];
  const [open, setOpen] = useState<number | null>(null);
  const panelId = useId();
  const count = tiles.length;
  const active = open === null ? null : tiles[open];
  const detail = active?.props.detail;

  return (
    <div className="overflow-hidden rounded-[var(--radius-panel)] border border-edge bg-surface">
      <div
        className={cn(
          "grid grid-cols-2 divide-x divide-y divide-edge md:divide-y-0",
          count === 3 && "md:grid-cols-3",
          count === 4 && "md:grid-cols-4",
          count >= 5 && "md:grid-cols-5",
          // Odd count → the last tile fills the row on mobile, never orphans.
          count % 2 === 1 && "[&>*:last-child]:col-span-2 md:[&>*:last-child]:col-span-1",
        )}
      >
        {tiles.map((tile, i) =>
          cloneElement(tile, {
            key: i,
            _index: i,
            _open: open === i,
            _panelId: panelId,
            _onToggle: () => setOpen((current) => (current === i ? null : i)),
          }),
        )}
      </div>

      {detail && (
        <div
          id={panelId}
          // Escape closes, because a drawer that can only be shut by finding the
          // same tile again is a drawer people leave open.
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(null);
          }}
          className="border-t border-edge bg-surface-2/40"
        >
          <div data-reveal="open" className="p-4 md:p-5">
            {detail}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One cell of the strip.
 *
 * Numbers are tabular here — unlike the hero figure, these sit in a row of
 * siblings, and a jittering column of digits across four cells is exactly the
 * "hard to parse" complaint.
 */
export function StatTile({
  label,
  value,
  hint,
  delta,
  trend,
  href,
  detail,
  _open,
  _panelId,
  _onToggle,
}: TileProps) {
  const openable = Boolean(detail && _onToggle);

  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className={microLabel}>{label}</p>
        {openable ? (
          <ChevronDown
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 text-ink-3 transition-transform duration-150 motion-reduce:transition-none",
              _open && "rotate-180 text-ink",
            )}
          />
        ) : (
          href && (
            <ArrowUpRight
              aria-hidden
              className="size-3.5 shrink-0 text-ink-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
            />
          )
        )}
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <p className="font-sans text-[1.6rem] font-medium leading-none tracking-[-0.025em] text-ink tabular-nums">
          {typeof value === "number" ? value.toLocaleString() : value}
        </p>
        {delta}
      </div>

      {hint && <p className="mt-1.5 text-[11.5px] leading-snug text-ink-3">{hint}</p>}
      {trend && <div className="mt-2.5">{trend}</div>}
    </>
  );

  const cell = "relative flex flex-col justify-start px-4 py-3.5 text-left";
  // The open tile is marked at its own bottom edge, so the drawer below reads as
  // belonging to this cell rather than to the strip as a whole.
  const marker = (
    <span
      aria-hidden
      className={cn(
        "absolute inset-x-0 bottom-0 h-[2px] transition-opacity duration-150",
        _open ? "bg-signal opacity-100" : "opacity-0",
      )}
    />
  );

  if (openable) {
    return (
      <button
        type="button"
        onClick={_onToggle}
        aria-expanded={_open}
        aria-controls={_panelId}
        className={cn(
          cell,
          "group outline-none transition-colors hover:bg-surface-2/70 focus-visible:bg-surface-2",
          _open && "bg-surface-2/70",
        )}
      >
        {body}
        {marker}
      </button>
    );
  }

  if (!href) return <div className={cn(cell, "cursor-default")}>{body}</div>;

  return (
    <Link
      href={href}
      className={cn(
        cell,
        "group outline-none transition-colors hover:bg-surface-2/70 focus-visible:bg-surface-2",
      )}
    >
      {body}
    </Link>
  );
}

/**
 * Period-over-period change, next to the number it qualifies.
 *
 * A metric without a comparison is trivia: 1,240 calls is only meaningful
 * against what last month did. This is the single most common thing missing from
 * a homegrown dashboard and the first thing present in every professional one.
 *
 * Deliberately NOT colour-coded by direction. Up is good for calls and bad for
 * failures, and a green arrow that means "worse" on two of five tiles is worse
 * than no colour at all. Direction is carried by the glyph and the sign; callers
 * that genuinely have a polarity pass `tone`.
 */
export function Delta({
  pct,
  tone = "neutral",
}: {
  /** Percent change. Null renders nothing — no baseline, no claim. */
  pct: number | null;
  tone?: "neutral" | "good" | "bad";
}) {
  if (pct === null || !Number.isFinite(pct)) return null;
  const rounded = Math.round(pct);
  if (rounded === 0) {
    return <span className="text-[11.5px] tabular-nums text-ink-3">flat</span>;
  }
  return (
    <span
      className={cn(
        "text-[11.5px] font-medium tabular-nums",
        tone === "neutral" && "text-ink-2",
        tone === "good" && "text-ok",
        tone === "bad" && "text-bad",
      )}
    >
      {rounded > 0 ? "↑" : "↓"}
      {Math.abs(rounded)}%
    </span>
  );
}

/**
 * The single number a view leads with. Exactly one per page, a second one just
 * makes both smaller. Proportional figures: a standalone number set in tabular
 * digits reads loose at this size.
 */
export function HeroFigure({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: string | number;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className={microLabel}>{label}</p>
      <p
        className={cn(
          "mt-1.5 font-sans font-medium tracking-[-0.03em] text-ink",
          "text-[2.25rem] leading-none md:text-[2.5rem]",
        )}
      >
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      {hint && <p className="mt-2 text-[12.5px] text-ink-2">{hint}</p>}
    </div>
  );
}

/** Label + value row for the secondary rail. */
export function RailStat({
  label,
  value,
  children,
}: {
  label: string;
  value: string | number;
  children?: ReactNode;
}) {
  return (
    <div>
      <p className={microLabel}>{label}</p>
      <p className="mt-1 font-sans text-lg font-medium tracking-[-0.02em] text-ink tabular-nums">
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}
