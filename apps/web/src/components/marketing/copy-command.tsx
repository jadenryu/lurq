"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The install command is the call to action, so it is a button that copies
 * rather than a link that navigates. Three sizes for the three places it
 * appears: the nav chip, the hero, and the final band.
 *
 * Transitions are colour only, 120ms — no scale, no lift.
 */
export function CopyCommand({
  command,
  variant = "chip",
  className,
  label,
}: {
  command: string;
  variant?: "chip" | "primary" | "block" | "quiet" | "line";
  className?: string;
  /** Overrides the visible text; the copied payload is always `command`. */
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      return; // clipboard blocked — the command is selectable text either way
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  }

  const shared =
    "group inline-flex max-w-full items-center gap-2 font-mono transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2";

  // Focus and the copy-confirm both land on --mark. It is the only colour here
  // that isn't a verdict, which is what keeps the verdict colours meaning one
  // thing.
  const variants = {
    chip: "h-8 rounded px-2.5 text-[0.75rem] bg-paper-2 text-ink hover:bg-rule/70 focus-visible:outline-mark",
    primary:
      "h-11 rounded px-5 text-[0.875rem] bg-ink text-paper hover:bg-ink/85 focus-visible:outline-mark",
    block:
      "h-14 rounded-lg px-6 text-[0.95rem] bg-viewport-2 text-viewport-ink hover:bg-viewport-3 focus-visible:outline-mark-lift",
    quiet:
      "h-10 w-full justify-between rounded px-4 text-[0.8125rem] bg-viewport-2 text-viewport-ink hover:bg-viewport-3 focus-visible:outline-mark-lift",
    line: "h-10 w-full justify-between rounded border border-rule bg-paper px-4 text-[0.8125rem] text-ink hover:border-mark/50 focus-visible:outline-mark",
  } as const;

  const onDark = variant === "block" || variant === "quiet";

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy: ${command}`}
      className={cn(shared, variants[variant], className)}
    >
      <span className="truncate">{label ?? command}</span>
      <span
        aria-hidden
        className={cn(
          "shrink-0 transition-colors duration-[120ms]",
          copied
            ? onDark
              ? "text-mark-lift"
              : variant === "primary"
                ? "text-paper"
                : "text-mark"
            : "opacity-60 group-hover:opacity-100",
        )}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </span>
      <span className="sr-only" role="status">
        {copied ? "copied" : ""}
      </span>
    </button>
  );
}
