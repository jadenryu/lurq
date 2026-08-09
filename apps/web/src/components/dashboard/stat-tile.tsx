import type { ReactNode } from "react";
import { Panel, eyebrow } from "@/components/dashboard/panel";
import { cn } from "@/lib/utils";

/**
 * Stat tiles and the hero figure — the right form when the answer is one number
 * rather than a distribution (a one-bar bar chart is never the answer).
 *
 * Both use the brand heading face at **proportional** figures. `tabular-nums`
 * gives every digit the width of a zero, which makes a large standalone number
 * like `121` look loose; it's reserved here for columns that must align
 * vertically (table rows, axis ticks).
 */

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
 * The single number a view leads with. Exactly one per page — a second one just
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
