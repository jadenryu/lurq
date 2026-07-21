import { cn } from "@/lib/utils";

/**
 * Numbered, monospace section eyebrow — the small "[ 02 ] benchmark" marker that
 * gives the page its terminal-native, hand-built rhythm (Zomma/Nia style).
 */
export function SectionLabel({
  index,
  children,
  align = "left",
  className,
}: {
  /** Two-digit section number, e.g. 2 -> "02". */
  index: number;
  children: React.ReactNode;
  align?: "left" | "center";
  className?: string;
}) {
  const n = String(index).padStart(2, "0");
  return (
    <div
      className={cn(
        "flex items-center gap-3 font-mono text-xs uppercase tracking-[0.24em] text-muted-foreground",
        align === "center" && "justify-center",
        className,
      )}
    >
      <span className="text-brand">[ {n} ]</span>
      <span>{children}</span>
      {align === "left" ? (
        <span aria-hidden className="h-px flex-1 bg-border" />
      ) : null}
    </div>
  );
}
