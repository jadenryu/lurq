import { Children, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { microLabel } from "@/components/dashboard/panel";
import { cn } from "@/lib/utils";

/**
 * The metric strip: **one** bordered band split by hairlines, not N floating
 * cards with N shadows and N gutters between them.
 *
 * Four separate cards say "four unrelated objects". One divided strip says "four
 * readings off the same instrument", which is what they are, and it is what every
 * console worth copying does with its headline numbers. It also buys back the
 * gutters as data width at no cost.
 *
 * Mobile is two up, split by both rules; an odd last tile spans the row rather
 * than orphaning next to a hole.
 */
export function StatRow({ children }: { children: ReactNode }) {
  const count = Children.count(children);
  return (
    <div
      className={cn(
        "grid grid-cols-2 overflow-hidden rounded-[var(--radius-panel)] border border-edge bg-surface",
        "divide-x divide-y divide-edge md:divide-y-0",
        count === 3 && "md:grid-cols-3",
        count === 4 && "md:grid-cols-4",
        count >= 5 && "md:grid-cols-5",
        count % 2 === 1 && "[&>*:last-child]:col-span-2 md:[&>*:last-child]:col-span-1",
      )}
    >
      {children}
    </div>
  );
}

/**
 * One cell of the strip. Numbers are tabular here — unlike the hero figure, these
 * sit in a row of siblings and a jittering column of digits across four cells is
 * exactly the "hard to parse" complaint.
 */
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
   * Where this number came from. A stat is a claim, and the first thing anyone
   * wants from a claim is the rows behind it. Tiles without a destination stay
   * inert on purpose.
   */
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className={microLabel}>{label}</p>
        {href && (
          <ArrowUpRight
            aria-hidden
            className="size-3.5 shrink-0 text-ink-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
          />
        )}
      </div>
      <p className="mt-2 font-sans text-[1.6rem] font-medium leading-none tracking-[-0.025em] text-ink tabular-nums">
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      {hint && <p className="mt-1.5 text-[11.5px] leading-snug text-ink-3">{hint}</p>}
      {trend && <div className="mt-2.5">{trend}</div>}
    </>
  );

  const cell = "flex flex-col justify-start px-4 py-3.5";

  if (!href) return <div className={cell}>{body}</div>;

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
