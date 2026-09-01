import { Children, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Panel, eyebrow } from "@/components/dashboard/panel";
import { cn } from "@/lib/utils";

/**
 * Stat tiles and the hero figure: the right form when the answer is one number
 * rather than a distribution (a one-bar bar chart is never the answer).
 *
 * Both use the brand heading face at **proportional** figures. `tabular-nums`
 * gives every digit the width of a zero, which makes a large standalone number
 * like `121` look loose; it's reserved here for columns that must align
 * vertically (table rows, axis ticks).
 */

/**
 * The row a page's stat tiles live in.
 *
 * This existed three times, spelled differently each time: `md:grid-cols-4` on
 * the repo list, `md:grid-cols-5` on repo detail, and `lg:grid-cols-4` on the
 * overview. That last one is the bug you can actually see — between 768px and
 * 1024px the overview dropped to two columns while every other page still showed
 * four, so moving between tabs resized the tiles for no reason a reader could
 * attribute to anything. Owning the grid here is what makes "uneven between
 * views" impossible rather than merely fixed once.
 *
 * The column count still follows the number of tiles (four stats want four
 * columns, five want five) — a row of equal-height tiles reads as deliberate at
 * either count. What must not vary is the breakpoint, the gutter, and the
 * mobile behaviour, and none of them can now.
 *
 * On mobile it is always two up, and an odd last tile spans the full width
 * rather than sitting next to a hole — an orphan half-tile is the single
 * strongest "unfinished" tell on a phone.
 */
export function StatRow({ children }: { children: ReactNode }) {
  const count = Children.count(children);
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-3",
        count === 3 && "md:grid-cols-3",
        count === 4 && "md:grid-cols-4",
        count >= 5 && "md:grid-cols-5",
        // Odd count → the last tile fills the row on mobile, never orphans.
        count % 2 === 1 && "[&>*:last-child]:col-span-2 md:[&>*:last-child]:col-span-1",
      )}
    >
      {children}
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  trend,
  href,
}: {
  label: string;
  value: string | number;
  hint?: string;
  trend?: ReactNode;
  /**
   * Where this number came from.
   *
   * A stat is a claim, and the first thing anyone wants from a claim is the
   * rows behind it — "36 behind" is only useful if it takes you to the 36. When
   * a tile has a destination it becomes a real link: pointer, hover lift, focus
   * ring, and a caret that appears on hover so the affordance is visible before
   * the click rather than discovered by accident.
   *
   * Tiles without a destination stay inert on purpose. A cursor that changes
   * over something that does nothing is worse than one that never changes.
   */
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className={eyebrow}>{label}</p>
        {href && (
          <ChevronRight
            aria-hidden
            className="size-3.5 shrink-0 -translate-x-1 text-ink-3 opacity-0 transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100"
          />
        )}
      </div>
      <div className="mt-3">
        <p className="font-sans text-2xl font-medium tracking-[-0.02em] text-ink md:text-3xl">
          {typeof value === "number" ? value.toLocaleString() : value}
        </p>
        {hint && <p className="mt-1 font-mono text-[0.65rem] text-ink-3">{hint}</p>}
      </div>
      {trend && <div className="mt-3">{trend}</div>}
    </>
  );

  if (!href) {
    return (
      <Panel padding="tight" className="flex flex-col justify-between">
        {body}
      </Panel>
    );
  }

  return (
    <Link
      href={href}
      className="group rounded-[var(--radius-panel)] outline-none transition-transform duration-150 hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-signal/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg motion-reduce:hover:translate-y-0 motion-reduce:transition-none"
    >
      <Panel
        padding="tight"
        className="h-full flex-col justify-between transition-colors duration-150 group-hover:border-edge-lit flex"
      >
        {body}
      </Panel>
    </Link>
  );
}

/**
 * The single number a view leads with. Exactly one per page, a second one just
 * makes both smaller.
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
      <p className={eyebrow}>{label}</p>
      <p
        className={cn(
          "mt-2 font-sans font-medium tracking-[-0.025em] text-ink",
          "text-[2.75rem] leading-none md:text-[3.25rem]",
        )}
      >
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      {hint && <p className="mt-2 text-sm text-ink-2">{hint}</p>}
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
      <p className={eyebrow}>{label}</p>
      <p className="mt-1.5 font-sans text-xl font-medium tracking-[-0.02em] text-ink">
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}
