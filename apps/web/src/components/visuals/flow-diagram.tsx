import { Fragment } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface Step {
  title: string;
  sub?: string;
}

// A small horizontal (stacks vertically on mobile) flow of labelled nodes
// joined by arrows. A real, themed diagram in place of a flat placeholder.
export function FlowDiagram({
  steps,
  className,
}: {
  steps: Step[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-stretch gap-3 md:flex-row md:items-center",
        className,
      )}
    >
      {steps.map((step, i) => (
        <Fragment key={step.title}>
          <div className="surface-glow flex flex-1 flex-col justify-center rounded-[var(--radius-lg)] border border-border bg-card px-4 py-5 text-center">
            <div className="text-sm font-medium text-foreground">
              {step.title}
            </div>
            {step.sub ? (
              <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {step.sub}
              </div>
            ) : null}
          </div>
          {i < steps.length - 1 ? (
            <ArrowRight
              aria-hidden
              className="mx-auto size-4 shrink-0 rotate-90 text-muted-foreground/40 md:rotate-0"
            />
          ) : null}
        </Fragment>
      ))}
    </div>
  );
}
