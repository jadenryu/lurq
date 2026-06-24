import { cn } from "@/lib/utils";

// Themed stand-in for an image or diagram we haven't produced yet. A dashed
// card on the dark surface with a centered label — obviously a placeholder,
// never mistaken for finished art.
export function Placeholder({
  label = "Placeholder",
  sublabel,
  aspect = "16 / 9",
  className,
}: {
  label?: string;
  sublabel?: string;
  /** CSS aspect-ratio string, e.g. "16 / 9" or "4 / 3" */
  aspect?: string;
  className?: string;
}) {
  return (
    <div
      style={{ aspectRatio: aspect }}
      className={cn(
        "flex w-full flex-col items-center justify-center gap-1 rounded-[var(--radius-lg)] border border-dashed border-border bg-card/40 text-center",
        className,
      )}
    >
      <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
        {label}
      </span>
      {sublabel ? (
        <span className="text-xs text-muted-foreground/40">{sublabel}</span>
      ) : null}
    </div>
  );
}
