import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Greyscale conic-gradient border, matching the FAQ card treatment. A 1px
// gradient rim around a solid card: premium feel without leaving the
// monochrome palette.
export function GradientBorder({
  children,
  className,
  innerClassName,
}: {
  children: ReactNode;
  className?: string;
  innerClassName?: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[var(--radius-xl)] bg-[conic-gradient(from_140deg_at_50%_50%,#27272a,#8b8b93,#3f3f46,#a1a1aa,#52525b,#18181b,#6b6b73,#27272a)] p-px shadow-2xl shadow-black/40",
        className,
      )}
    >
      <div
        className={cn(
          "relative h-full rounded-[calc(var(--radius-xl)-1px)] bg-card",
          innerClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}
