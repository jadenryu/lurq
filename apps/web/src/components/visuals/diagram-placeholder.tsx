import { cn } from "@/lib/utils";

// Placeholder for a real mermaid/SVG stack diagram (swap in later).
export function DiagramPlaceholder({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative flex aspect-[16/10] w-full items-center justify-center overflow-hidden rounded-lg border border-border bg-background/60",
        className,
      )}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle,rgba(255,255,255,0.06)_1px,transparent_1px)] bg-[size:18px_18px]" />
      <span className="relative text-xs uppercase tracking-[0.18em] text-muted-foreground/70">
        stack diagram – coming soon
      </span>
    </div>
  );
}
