"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { COPIED_LABEL, COPY_GLYPH, COPY_HINT } from "@/content/copy";
import { cn } from "@/lib/utils";

/**
 * The install command as a button, in the nav and again in the hero.
 *
 * `navigator.clipboard` is unavailable on insecure origins and blocked inside
 * some embedded browsers, so a failure falls back to a detached textarea and
 * `document.execCommand`. Deprecated, still the only thing that works there,
 * and a copy button that silently does nothing is worse than a deprecation.
 *
 * On success the label swaps to `copied` for 1600ms. That is the copy-confirm
 * state, which is why it lands on --held rather than on --mark: it is reporting
 * that something held, not that something is interactive.
 */

/** Returns whether the fallback actually put the text on the clipboard. */
function legacyCopy(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  // Off-screen rather than hidden: display:none and visibility:hidden are both
  // unselectable, and execCommand copies the selection.
  area.style.position = "fixed";
  area.style.top = "-9999px";
  area.style.opacity = "0";
  document.body.appendChild(area);

  try {
    area.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(area);
  }
}

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
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(command);
      ok = true;
    } catch {
      ok = legacyCopy(command);
    }
    // Nothing was copied, so nothing claims it was.
    if (!ok) return;

    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }, [command]);

  return (
    <>
      <button
        type="button"
        onClick={copy}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-md font-mono transition-[color,background-color,border-color] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark",
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
