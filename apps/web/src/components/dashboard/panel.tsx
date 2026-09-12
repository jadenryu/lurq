import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The dashboard's one surface treatment.
 *
 * Flat, not lifted. A drop shadow under every panel is what made this route read
 * as a scrapbook of cards floating on a field: fifteen boxes each claiming to be
 * the front-most thing on screen, none of them grouping with the others. Real
 * consoles (Cloudflare, OpenRouter, Vercel) draw one hairline and stop — depth is
 * spent on the *one* thing that floats (a menu, a dialog), never on content.
 *
 * So: `--surface` ground, a 1px `--edge` border, a 6px corner, and no shadow.
 * Hierarchy comes from the header rule, the padding step, and the ink ramp.
 *
 * `--panel-px` is published on the element so `PanelHeader` can bleed its rule
 * to the panel's edges without knowing which padding step the caller chose.
 */

/** A label, set like the rest of the page: weight and value carry it, not caps. */
export const eyebrow = "text-[12px] font-medium tracking-[-0.005em] text-ink-3";

/** Column heads, filter labels, section meta: the one place small caps earn it. */
export const microLabel =
  "text-[10.5px] font-medium uppercase tracking-[0.07em] text-ink-3";

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
      style={
        {
          "--panel-px": padding === "tight" ? "0.875rem" : "1.125rem",
        } as React.CSSProperties
      }
      className={cn(
        "rounded-[var(--radius-panel)] border border-edge bg-surface",
        padding !== "none" && "p-[var(--panel-px)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Section head: title, optional trailing slot, and a rule that runs the full
 * width of the panel rather than stopping inside its padding. The full-bleed rule
 * is the whole difference between "a card with some text at the top" and a
 * console section — it's what tells you the header governs everything below it.
 */
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
    <div
      className={cn(
        // `[&+*]:mt-0!` is the reason this is one line instead of fifteen edits:
        // every caller predates the rule and hand-wrote its own `mt-4`/`mt-5`
        // under the old text-only header, which would now stack on top of the
        // header's own gap. The header owns the space beneath it.
        "-mx-[var(--panel-px)] -mt-[var(--panel-px)] mb-[var(--panel-px)] flex h-11 items-center justify-between gap-4 border-b border-edge px-[var(--panel-px)] [&+*]:mt-0!",
        className,
      )}
    >
      <p className="text-[13px] font-medium tracking-[-0.01em] text-ink">{title}</p>
      {trailing}
    </div>
  );
}

/**
 * Small outline chip. `tone` carries state, using the reserved status hues from
 * the soft syntax palette: never a solid saturated badge, and never a status
 * color standing in for plain identity (that's what `neutral` is for).
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
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-[var(--radius-chip)] border px-1.5 py-px text-[10.5px] font-medium uppercase tracking-[0.05em]",
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
    <div className="relative overflow-hidden rounded-[var(--radius-control)] border border-edge bg-surface-2 px-4 py-4">
      <span aria-hidden className="absolute inset-y-0 left-0 w-[2px] bg-signal/40" />
      <p className="text-sm font-medium tracking-tight">{title}</p>
      {children && (
        <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-ink-2">{children}</p>
      )}
      {action && <div className="mt-3">{action}</div>}
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

/**
 * A dense row list — the console answer to "several things, each with a couple of
 * facts". Rows are hairline-separated, full-bleed inside their panel, and light
 * up on hover so the row (not a 40px label inside it) is the target.
 *
 * Pair with `padding="none"` on the Panel so the rows reach the border.
 */
export function Rows({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cn("divide-y divide-edge", className)}>{children}</ul>;
}

export function Row({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <li
      className={cn(
        "flex items-center gap-3 px-[var(--panel-px)] py-2 transition-colors hover:bg-surface-2/70",
        className,
      )}
    >
      {children}
    </li>
  );
}
