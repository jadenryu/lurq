import { Children, type ReactNode } from "react";
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
}: {
  label: string;
  value: string | number;
  hint?: string;
  trend?: ReactNode;
}) {
  return (
    <Panel padding="tight" className="flex flex-col justify-between">
      <p className={eyebrow}>{label}</p>
      <div className="mt-3">
        <p className="font-sans text-2xl font-medium tracking-[-0.02em] text-ink md:text-3xl">
          {typeof value === "number" ? value.toLocaleString() : value}
        </p>
        {hint && <p className="mt-1 font-mono text-[0.65rem] text-ink-3">{hint}</p>}
      </div>
      {trend && <div className="mt-3">{trend}</div>}
    </Panel>
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
