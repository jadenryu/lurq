import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A label, and the reason behind a caret.
 *
 * Written once for the autopilot panel and now shared, because the wall of
 * prose it was built to fold away had grown in three places at once: nine
 * selection rules each carrying a paragraph, the terms panel under them, and
 * the settings it came from. Every one of those is the right information at the
 * wrong altitude — the text is worth reading once and then never again, and
 * stacked it turns a control surface into a document nobody scrolls.
 *
 * Native `<details>`, not a state hook: it is a disclosure widget, the platform
 * ships one, and this way it works before hydration, prints open, and answers
 * ctrl-F. Anything interactive belongs OUTSIDE `<summary>`, or clicking the
 * control toggles the text instead of doing its job.
 *
 * What belongs behind this caret: what a setting will do — its blast radius,
 * what it will refuse, what it deliberately will not touch. What belongs in an
 * `InfoButton` instead: why the thing exists and where a number came from. The
 * split is consequence versus context, and it is why a dismissible bubble is
 * the wrong home for the first one.
 */
export function Disclosure({
  label,
  children,
  className,
  tone = "default",
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
  /** `quiet` drops the label to secondary ink, for a term rather than a setting. */
  tone?: "default" | "quiet";
}) {
  return (
    <details className={cn("group min-w-0", className)}>
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center gap-1.5 text-[13px] [&::-webkit-details-marker]:hidden",
          tone === "quiet" ? "text-ink-2 hover:text-ink" : "text-ink",
        )}
      >
        {label}
        <ChevronRight
          aria-hidden
          className="size-3.5 shrink-0 text-ink-3 transition-transform group-open:rotate-90 motion-reduce:transition-none"
        />
      </summary>
      <div className="mt-1.5 max-w-prose pr-4 text-[12.5px] leading-relaxed text-ink-2">
        {children}
      </div>
    </details>
  );
}
