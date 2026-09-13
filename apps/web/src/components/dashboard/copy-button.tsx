"use client";

import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/lib/use-copy";
import { cn } from "@/lib/utils";

/**
 * The dashboard's copy control, in the two shapes it is ever needed.
 *
 * `CopyButton` is a real button for a real action ("copy for agent", "copy
 * workflow"). `CopyInline` is the bare variant for a value that happens to be
 * copyable — a key prefix, a command in a code block — where button chrome would
 * be louder than the thing it wraps.
 *
 * Both take the payload as a prop rather than building it, so the text can be
 * assembled on the server where the data already is: a client component that
 * fetches in order to copy is a second source of truth for what the page says.
 *
 * The live region sits *outside* the button. Inside, it would be folded into the
 * accessible name, and the button would announce itself as "copy for agent
 * copied" forever after the first click.
 */
export function CopyButton({
  text,
  label,
  copiedLabel = "copied",
  variant = "outline",
  size = "sm",
  className,
  /** Announced instead of the visible label, when the label is only a glyph. */
  srLabel,
  onCopy,
}: {
  text: string;
  label?: string;
  copiedLabel?: string;
  variant?: "default" | "outline" | "ghost";
  size?: "sm" | "default";
  className?: string;
  srLabel?: string;
  /** Called after a copy that actually reached the clipboard. */
  onCopy?: () => void;
}) {
  const { copied, copy } = useCopy();
  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={() => void copy(text).then((ok) => ok && onCopy?.())}
        className={cn("gap-1.5", className)}
      >
        {copied ? (
          <Check aria-hidden className="size-3.5 text-ok" />
        ) : (
          <Copy aria-hidden className="size-3.5" />
        )}
        {label && <span>{copied ? copiedLabel : label}</span>}
        {srLabel && <span className="sr-only">{srLabel}</span>}
      </Button>
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? copiedLabel : ""}
      </span>
    </>
  );
}

/** Bare variant: a line of text that is copyable, with no button chrome. */
export function CopyInline({
  text,
  label,
  className,
  onCopy,
}: {
  text: string;
  label: string;
  className?: string;
  onCopy?: () => void;
}) {
  const { copied, copy } = useCopy();
  return (
    <>
      <button
        type="button"
        onClick={() => void copy(text).then((ok) => ok && onCopy?.())}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-[var(--radius-chip)] text-[12px] outline-none transition-colors focus-visible:ring-1 focus-visible:ring-signal/60",
          copied ? "text-ok" : "text-ink-3 hover:text-ink",
          className,
        )}
      >
        {copied ? (
          <Check aria-hidden className="size-3" />
        ) : (
          <Copy aria-hidden className="size-3" />
        )}
        {copied ? "copied" : label}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? "copied" : ""}
      </span>
    </>
  );
}
