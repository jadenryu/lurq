"use client";

import { COPIED_LABEL, COPY_GLYPH, COPY_HINT } from "@/content/copy";
import { useCopy } from "@/lib/use-copy";
import { cn } from "@/lib/utils";

/**
 * The install command as a button, in the nav and again in the hero.
 *
 * The clipboard mechanics — the insecure-origin fallback, the cleared timer,
 * the refusal to claim a copy that did not happen — live in `useCopy`, shared
 * with the dashboard's buttons. This file is the marketing surface's styling of
 * them and nothing else.
 *
 * On success the label swaps to `copied`. That is the copy-confirm
 * state, which is why it lands on --held rather than on --mark: it is reporting
 * that something held, not that something is interactive.
 */

export function CopyCommandButton({
  command,
  label,
  variant,
  className,
}: {
  command: string;
  label: string;
  /** `solid` is the hero primary; `outline` is a chip; `bare` is a line of text
   *  that happens to be copyable, with no button chrome at all. */
  variant: "solid" | "outline" | "bare";
  className?: string;
}) {
  const { copied, copy } = useCopy();

  return (
    <>
      <button
        type="button"
        onClick={() => void copy(command)}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full font-mono transition-[color,background-color,border-color] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark",
          variant === "solid"
            ? "h-11 bg-ink px-5 text-[14px] text-ground hover:bg-white"
            : variant === "outline"
              ? "h-9 border border-edge bg-surface px-3 text-[13px] text-ink hover:border-edge-lit"
              : "text-[12px] text-ink-3 hover:text-ink-2",
          className,
        )}
        style={{ transitionDuration: "var(--dur-hover)" }}
      >
        {/* The accessible name is built from the visible label plus the hint,
            so it contains the visible text verbatim. The glyph is decoration
            and is not part of either. */}
        <span className={copied ? "text-held" : undefined}>
          {copied ? COPIED_LABEL : label}
        </span>
        <span aria-hidden className="pl-2 text-[13px] opacity-60">
          {COPY_GLYPH}
        </span>
        <span className="sr-only">, {COPY_HINT}</span>
      </button>
      {/* Outside the button: a live region inside it would land in the name. */}
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? COPIED_LABEL : ""}
      </span>
    </>
  );
}
