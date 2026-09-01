"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * A table row that opens onto its own detail, in place.
 *
 * Every data table in this dashboard had the same shape: a summary row carrying
 * four or five columns, and a backing record carrying more than that — which
 * manifests declare a dependency, which advisory ids a count refers to, which
 * packages are on either side of a conflict. The extra was fetched, serialised,
 * sent, and then dropped, because there was nowhere to put it. This is the
 * nowhere.
 *
 * In place rather than a drawer or a dialog: the question these rows raise is
 * comparative ("why is *this* one flagged and the one under it isn't"), and a
 * modal answers it by hiding the comparison. Expansion keeps both on screen.
 *
 * `TableRow` already shipped `has-aria-expanded:bg-muted/50`, so the summary row
 * tints while open with no new styling — the hook was there before the feature.
 *
 * Accessibility is the point of the extra markup, not decoration:
 * - the trigger is a real `<button>`, so Enter/Space work and it lands in the
 *   tab order without a `tabIndex` scattering
 * - `aria-expanded` and `aria-controls` tie it to the panel, so a screen reader
 *   announces state rather than reading two unrelated rows
 * - the caret rotation is suppressed under `prefers-reduced-motion`
 *
 * Not Base UI's Collapsible, deliberately: `Collapsible.Root` renders a `<div>`
 * that would have to wrap both rows, and a `<div>` between `<tbody>` and `<tr>`
 * is invalid HTML that browsers silently reparent. Two sibling `<tr>`s and one
 * boolean is the correct shape here. Collapsible stays right for panel-level
 * sections, where a wrapper element is legal.
 */
export function ExpandableRow({
  summary,
  detail,
  colSpan,
  label,
  defaultOpen = false,
  className,
}: {
  /** The cells of the summary row. The first one gets the caret. */
  summary: ReactNode;
  /** Rendered inside a full-width cell beneath, only while open. */
  detail: ReactNode;
  /** How many columns the detail cell spans — must match the table's width. */
  colSpan: number;
  /** Accessible name for the toggle, e.g. the package name. */
  label: string;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <>
      <TableRow
        className={cn("border-border", className)}
        data-state={open ? "open" : undefined}
      >
        <TableCell className="w-8 pl-3 pr-0 align-middle md:pl-4">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={panelId}
            className="flex size-6 items-center justify-center rounded-[var(--radius-chip)] text-ink-3 outline-none transition-colors hover:bg-surface-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-signal/50"
          >
            <span className="sr-only">
              {open ? `Hide details for ${label}` : `Show details for ${label}`}
            </span>
            <ChevronRight
              aria-hidden
              className={cn(
                "size-3.5 transition-transform duration-150 motion-reduce:transition-none",
                open && "rotate-90",
              )}
            />
          </button>
        </TableCell>
        {summary}
      </TableRow>
      {open && (
        <TableRow className="border-border bg-surface-2/40 hover:bg-surface-2/40">
          <TableCell id={panelId} colSpan={colSpan} className="px-3 py-0 md:px-4">
            <div className="py-3">{detail}</div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/**
 * A labelled fact inside an expanded row.
 *
 * Detail panels drift into being little pages if each one invents its own
 * layout, so they all get the same two-column grid: a fixed-width label rail on
 * the left, the value on the right, aligned across every row of every table.
 */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1">
      <span className="w-24 shrink-0 font-mono text-[11px] uppercase tracking-wide text-ink-3">
        {label}
      </span>
      <span className="min-w-0 flex-1 text-sm text-ink-2">{children}</span>
    </div>
  );
}
