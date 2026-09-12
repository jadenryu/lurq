import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Chip } from "@/components/dashboard/panel";

/**
 * Page header, console-sized.
 *
 * This used to be a 3xl lowercase title over a full-width subtitle paragraph over
 * a rule — a magazine standfirst, ~110px of chrome above the first number on
 * every single page. A console spends that band on context and controls: the name
 * of the thing, its state, and what you can do to it, all on one line.
 *
 * So the title drops to 20px, the subtitle moves onto the same block at 13px, and
 * the action sits on the baseline beside them. `meta` is for status that belongs
 * to the page rather than to any one panel (a last-synced time, a plan, a count).
 */
export function PageHeader({
  title,
  subtitle,
  action,
  meta,
  demo = false,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  /** Page-level status, rendered right of the title at label scale. */
  meta?: ReactNode;
  demo?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-edge pb-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-[20px] font-medium lowercase tracking-[-0.02em] text-ink">
            {title}
          </h1>
          {demo && <Chip tone="warn">demo data</Chip>}
          {meta}
        </div>
        {subtitle && <p className="mt-1 text-[13px] text-ink-2">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/**
 * The body of a dashboard page: the gap under the header, and the rhythm between
 * the sections below it.
 *
 * Tightened one step (mt-8 → mt-5, space-y-6 → space-y-4). Vertical air is what
 * pushed the second half of every page below the fold; a console earns trust by
 * showing a whole system at once, not by letting each panel have its own room.
 *
 * `prose` is the one real exception rather than a per-page override: the guide is
 * long-form reading where sections want room to separate, not a board of panels
 * meant to be scanned as one screen.
 */
export function PageBody({
  children,
  variant = "default",
  className,
}: {
  children: ReactNode;
  variant?: "default" | "prose";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mt-5",
        variant === "default" && "space-y-4",
        variant === "prose" && "mt-8 space-y-12",
        className,
      )}
    >
      {children}
    </div>
  );
}
