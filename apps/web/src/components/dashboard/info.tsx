"use client";

import type { ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { Info } from "lucide-react";

/**
 * The background a panel used to print in full, on demand.
 *
 * Click, not hover. A hover tooltip does not exist on a touchscreen and is
 * unreachable from a keyboard, so half the readers of a hover-only explanation
 * never get one. Base UI's popover handles the focus trap, the escape key and
 * the aria wiring; the trigger is a real button.
 *
 * What belongs in here: why a thing exists, what it costs, where the number
 * came from — optional, nice-to-know. What does NOT: anything the reader has to
 * act on. The circled `i` reads as "extra", and a dismissible bubble is the
 * wrong home for a consequence, so blast radius stays on the page. That is the
 * split between this and the caret disclosures in the policy panel: carets hold
 * what a setting will do to your repository, this holds context.
 */
export function InfoButton({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={`About ${label}`}
        className="grid size-6 shrink-0 place-items-center rounded-[4px] text-ink-3 transition-colors hover:bg-muted/50 hover:text-ink-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-signal data-[popup-open]:bg-muted/50 data-[popup-open]:text-ink-2"
      >
        <Info aria-hidden className="size-[15px]" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="end" className="z-50">
          <Popover.Popup className="max-w-[min(20rem,calc(100vw-2rem))] rounded-[var(--radius-control)] border border-edge bg-surface-2 p-3 text-[12.5px] leading-relaxed text-ink-2 shadow-lg outline-none">
            <Popover.Title className="mb-1 text-[12px] font-medium text-ink">{label}</Popover.Title>
            <Popover.Description render={<div />}>{children}</Popover.Description>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
