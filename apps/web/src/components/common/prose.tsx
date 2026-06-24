import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Lightweight prose styling for long-form content (legal, about). Styles plain
// h2/h3/p/ul/a children so pages can be written as semantic markup without
// pulling in a typography plugin. Keeps lurq's greyscale palette + fonts.
export function Prose({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "space-y-5 text-[15px] leading-relaxed text-muted-foreground",
        "[&_h2]:mt-12 [&_h2]:font-heading [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground",
        "[&_h3]:mt-8 [&_h3]:text-base [&_h3]:font-medium [&_h3]:text-foreground",
        "[&_p]:max-w-none",
        "[&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-2 [&_a]:transition-colors hover:[&_a]:text-muted-foreground",
        "[&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_ul]:marker:text-muted-foreground/50",
        "[&_strong]:font-medium [&_strong]:text-foreground",
        "[&_code]:rounded [&_code]:bg-card [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px] [&_code]:text-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}
