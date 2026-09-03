import { Panel, PanelHeader, eyebrow } from "@/components/dashboard/panel";
import {
  currentStreak,
  level,
  longestStreak,
  monthLabels,
  thresholds,
  toWeeks,
  type Point,
} from "@/lib/activity-map";
import { fmtDay } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * A year of lurq calls, one square per day.
 *
 * The rest of this dashboard answers "what happened"; this answers "is lurq part
 * of how we work here". Those are different questions and only the second one is
 * legible at a glance — a year of daily volume in a trend line is a hairball,
 * while the same year laid out as weeks shows adoption, the week nobody touched
 * it, and the day someone wired it into CI.
 *
 * The one place in this dashboard where a color ramp is correct. Everywhere else
 * magnitude is already carried by bar length, so shading it too would burn the
 * color channel on information the geometry has (see `charts.tsx`). Here the
 * geometry is a fixed calendar grid: color is the *only* channel, and a
 * sequential ramp of the same single `signal` ink is exactly the right encoding.
 *
 * No `"use client"`, no hooks, no chart library: a grid of divs with native
 * `title` tooltips, rendered on the server. A year is 365 squares, and shipping
 * a hydration payload to hover them would cost more than the whole page.
 */

/** The ramp: one ink, five steps, zero rendered as the same inset track the bar
 *  charts use so an empty day reads as absence rather than as a low value. */
const LEVELS = [
  "bg-muted",
  "bg-signal/25",
  "bg-signal/45",
  "bg-signal/70",
  "bg-signal",
] as const;

export function ActivityMap({ series }: { series: Point[] }) {
  const total = series.reduce((s, p) => s + p.count, 0);
  const weeks = toWeeks(series);
  const q = thresholds(series.map((p) => p.count));
  const labels = monthLabels(weeks);
  const active = series.filter((p) => p.count > 0);
  const busiest = active.reduce<Point | null>(
    (best, p) => (best === null || p.count > best.count ? p : best),
    null,
  );

  return (
    <Panel>
      <PanelHeader
        title="activity map"
        trailing={
          <span className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-ink-3">
            {total.toLocaleString()} calls · {series.length} days
          </span>
        }
      />

      {/* The grid keeps its natural size and scrolls inside the card on narrow
          screens. Squashing 53 weeks into a phone width would make every square
          sub-pixel and the map unreadable. */}
      <div className="mt-5 overflow-x-auto pb-1">
        <div className="min-w-max">
          <div className="flex gap-[3px] pl-8">
            {labels.map((label, i) => (
              <span
                key={i}
                className="w-[11px] shrink-0 font-mono text-[0.6rem] text-ink-3"
                aria-hidden
              >
                {label ?? ""}
              </span>
            ))}
          </div>

          <div className="mt-1 flex gap-[3px]">
            {/* Mon/Wed/Fri only: labelling all seven rows at 11px is a wall of
                text for an axis whose job is orientation, not lookup. */}
            <div className="grid w-8 shrink-0 grid-rows-7 gap-[3px] pr-1 text-right">
              {["", "Mon", "", "Wed", "", "Fri", ""].map((d, i) => (
                <span
                  key={i}
                  className="font-mono text-[0.6rem] leading-[11px] text-ink-3"
                  aria-hidden
                >
                  {d}
                </span>
              ))}
            </div>

            {weeks.map((week, w) => (
              <div key={w} className="grid grid-rows-7 gap-[3px]">
                {Array.from({ length: 7 }, (_, d) => {
                  const cell = week[d] ?? null;
                  if (!cell) return <div key={d} className="h-[11px] w-[11px]" />;
                  const active = cell.count > 0;
                  return (
                    <div
                      key={d}
                      // Native title: a tooltip that needs no JS and survives
                      // with hydration off. It used to claim it also worked in
                      // keyboard focus order, which was not true — a bare <div>
                      // is not focusable, so the tooltip was pointer-only and
                      // every one of these 365 facts was unreachable without a
                      // mouse. `tabIndex` on the days that carry a number fixes
                      // that; empty days stay out of the tab order, because
                      // arrowing through 300 silent squares to reach the eight
                      // that say something is not access, it is a maze.
                      tabIndex={active ? 0 : undefined}
                      role={active ? "img" : undefined}
                      aria-label={
                        active
                          ? `${cell.count.toLocaleString()} call${cell.count === 1 ? "" : "s"} on ${fmtDay(cell.date)}`
                          : undefined
                      }
                      title={`${cell.count.toLocaleString()} call${cell.count === 1 ? "" : "s"} · ${fmtDay(cell.date)}`}
                      className={cn(
                        "h-[11px] w-[11px] rounded-[2px] ring-1 ring-inset ring-border/50 outline-none",
                        LEVELS[level(cell.count, q)],
                        active &&
                          "transition-[box-shadow,transform] duration-100 hover:scale-[1.35] hover:ring-signal focus-visible:scale-[1.35] focus-visible:ring-2 focus-visible:ring-signal motion-reduce:transition-none motion-reduce:hover:scale-100",
                      )}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <p className={eyebrow}>
          {total === 0
            ? "No calls yet. Squares fill in as your agents start calling lurq."
            : `${currentStreak(series)}-day streak · longest ${longestStreak(series)} · ${active.length} active days${
                busiest ? ` · busiest ${fmtDay(busiest.date)} (${busiest.count.toLocaleString()})` : ""
              }`}
        </p>
        <div className="flex items-center gap-1.5">
          <span className={eyebrow}>less</span>
          {LEVELS.map((bg, i) => (
            <span
              key={i}
              className={cn("h-[11px] w-[11px] rounded-[2px] ring-1 ring-inset ring-border/50", bg)}
              aria-hidden
            />
          ))}
          <span className={eyebrow}>more</span>
        </div>
      </div>

      {/* Pointer-free equivalent. Active days only — a 365-row table of mostly
          zeroes is not an accessible alternative, it's a haystack. */}
      {active.length > 0 && (
        <details className="group mt-4">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 font-mono text-[0.65rem] uppercase tracking-[0.16em] text-ink-3 transition-colors hover:text-foreground">
            <span className="transition-transform group-open:rotate-90">›</span>
            active days
          </summary>
          <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto">
            {[...active].reverse().map((p) => (
              <li key={p.date} className="font-mono text-xs text-muted-foreground">
                <span className="tabular-nums text-foreground">{p.count.toLocaleString()}</span>{" "}
                call{p.count === 1 ? "" : "s"} · {fmtDay(p.date)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Panel>
  );
}
