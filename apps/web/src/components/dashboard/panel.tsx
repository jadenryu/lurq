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

/**
 * Metric labels, section meta, axis captions.
 *
 * NOT uppercase. A 10px letterspaced all-caps label is the single most
 * template-looking thing a dashboard can put above a number — it is what every
 * generated admin panel ships, it costs legibility at the size it is used, and
 * a page carrying forty of them reads as chrome rather than as this product.
 * Caps survive in exactly one place, `columnLabel`, where the row above a table
 * has to be distinguishable from the rows below it at a glance.
 */
export const microLabel = "text-[12px] font-medium tracking-[-0.005em] text-ink-3";

/** Table column heads — the one place small caps still earn their keep. */
export const columnLabel =
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
 * Status chip.
 *
 * The old one was a 10.5px ALL-CAPS letterspaced outline pill. Three things were
 * wrong with it and they compound: caps at that size are read glyph by glyph, a
 * hairline outline on a dark ground is nearly invisible until you look for it,
 * and the same pill carried both state ("accepted") and identity ("parsing"), so
 * the reader could not tell from the shape whether they were looking at a verdict
 * or a label.
 *
 * Now: 12px, sentence-height, on the raised surface so it reads as an object
 * rather than as a rectangle drawn around some text. State is carried by a filled
 * dot — the badge convention every console shares — and identity by `neutral`,
 * which gets no dot at all. Colour never carries meaning alone: the word beside
 * the dot always says it too, which is what keeps it legible with a red-green
 * deficiency.
 */
export function Chip({
  children,
  tone = "neutral",
  dot,
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "bad" | "warn" | "accent";
  /** Defaults to on for every tone that means something; identity gets none. */
  dot?: boolean;
  className?: string;
}) {
  const showDot = dot ?? tone !== "neutral";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[4px] border bg-surface-2 px-2 py-[3px] text-[12px] font-medium leading-none tracking-[-0.005em]",
        tone === "neutral" && "border-edge text-ink-2",
        tone === "good" && "border-ok/25 text-ink",
        tone === "bad" && "border-bad/30 text-ink",
        tone === "warn" && "border-warn/30 text-ink",
        tone === "accent" && "border-edge-lit text-ink",
        className,
      )}
    >
      {showDot && (
        <span
          aria-hidden
          className={cn(
            "inline-block size-[5px] shrink-0 rounded-full",
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
export function InlineError({
  children,
  tone = "bad",
}: {
  children: ReactNode;
  /**
   * `info` for a note that is not a failure.
   *
   * The accent rule is what makes this read as "something went wrong", and it
   * was carrying messages that say the opposite — "Repositories connected" got
   * the same red bar as "Could not reach the repository service". A note with
   * no failure in it gets no rule, which leaves the box as what it is: a line
   * of page copy set apart from the panels around it.
   */
  tone?: "bad" | "info";
}) {
  return (
    <div className="relative overflow-hidden rounded-[var(--radius-control)] border border-edge bg-surface-2 px-4 py-3">
      {tone === "bad" && <span aria-hidden className="absolute inset-y-0 left-0 w-[2px] bg-bad" />}
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
