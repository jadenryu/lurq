import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The dashboard's one surface treatment: `.panel-lit` (the same lifted card with a
 * hairline top-light used by the marketing hero and benchmark sections), an
 * optional mono-uppercase eyebrow, and an optional right-aligned action. Every
 * panel on every dashboard page goes through here so padding, radius and eyebrow
 * styling can't drift card to card.
 *
 * Corners use `--radius-panel` (8px), not the marketing `--radius-xl` (~17px).
 */

/**
 * A label, set like the rest of the page.
 *
 * This was mono, uppercase, on a 0.16em track, the treatment the marketing
 * side removed in f4babe7 for the reason it applies here too: small-caps mono
 * labels read as chrome from a template rather than as this product's voice,
 * and stacked above every panel they were the loudest type on screen after the
 * numbers they were supposed to be subordinate to.
 *
 * Geist at 12px, medium, at --ink-3. The hierarchy is carried by weight and
 * value, which is what the variable font is for, and it matches the drift
 * board's headers exactly.
 */
export const eyebrow = "text-[12px] font-medium tracking-[-0.005em] text-ink-3";

export function Panel({
  children,
  className,
  padding = "default",
  id,
}: {
  children: ReactNode;
  className?: string;
  padding?: "default" | "tight" | "none";
  /** Anchor target, for pages that link to one panel in particular. */
  id?: string;
}) {
  return (
    <div
      id={id}
      className={cn(
        "panel-lit rounded-[var(--radius-panel)] border border-edge border-t-edge-lit",
        padding === "default" && "p-5 md:p-6",
        padding === "tight" && "p-4 md:p-5",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Eyebrow + optional trailing slot (a count, a toggle, a link). */
export function PanelHeader({
  title,
  trailing,
  className,
}: {
  title: string;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-4", className)}>
      <p className={eyebrow}>{title}</p>
      {trailing}
    </div>
  );
}

/**
 * Small outline chip. `tone` carries state, using the reserved status hues from
 * the soft syntax palette: never a solid saturated badge, and never a status
 * color standing in for plain identity (that's what `neutral` is for).
 *
 * Set in Geist, not mono. A chip is a label — "deprecated", "2 majors" — and
 * mono micro-caps on a label is the template chrome this file already retired
 * once for `eyebrow`. Mono is reserved for things whose characters matter:
 * versions, package names, paths, commands, key prefixes.
 */
export function Chip({
  children,
  tone = "neutral",
  dot = false,
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "bad" | "warn" | "accent";
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-[var(--radius-chip)] border px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.04em]",
        tone === "neutral" && "border-edge text-ink-2",
        tone === "good" && "border-ok/35 text-ok",
        tone === "bad" && "border-bad/40 text-bad",
        tone === "warn" && "border-warn/40 text-warn",
        tone === "accent" && "border-signal/40 text-signal",
        className,
      )}
    >
      {dot && (
        <span
          aria-hidden
          className={cn(
            "mr-1.5 inline-block size-1.5 rounded-full align-[1px]",
            tone === "good" && "bg-ok",
            tone === "bad" && "bg-bad",
            tone === "warn" && "bg-warn",
            tone === "accent" && "bg-signal",
            tone === "neutral" && "bg-ink-3",
          )}
        />
      )}
      {children}
    </span>
  );
}

/**
 * Empty state. Deliberately not a dashed box with a big glyph in it, that reads
 * as a broken upload widget. A left accent rule, a plain statement of what will
 * appear here, and (when there is one) the single action that makes it happen.
 */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-[var(--radius-control)] border border-edge bg-surface-2 px-5 py-6">
      <span aria-hidden className="absolute inset-y-0 left-0 w-[2px] bg-signal/40" />
      <p className="font-heading text-base font-medium tracking-tight">{title}</p>
      {children && (
        <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-ink-2">{children}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/**
 * Inline failure note, for a single card inside an otherwise working page.
 *
 * Page-level failures don't use this: they render the new-user state instead, so
 * nobody's first visit is an error message (see lib/dashboard-data).
 */
export function InlineError({ children }: { children: ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-[var(--radius-control)] border border-edge bg-surface-2 px-4 py-3">
      <span aria-hidden className="absolute inset-y-0 left-0 w-[2px] bg-bad" />
      <p className="text-sm text-ink-2">{children}</p>
    </div>
  );
}
