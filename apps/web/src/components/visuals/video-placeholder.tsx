import { Play } from "lucide-react";
import { cn } from "@/lib/utils";

// Hero right-side: a placeholder for the product demo video. Technical frame
// (corner brackets + dotted field) to match the rest of the page; swap the
// inner content for a real <video>/embed when the clip is ready.
export function VideoPlaceholder({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative aspect-video w-full overflow-hidden rounded-[var(--radius-lg)] border border-border/70 bg-card/20",
        className,
      )}
    >
      {/* corner brackets */}
      <span aria-hidden className="absolute left-0 top-0 size-3 border-l border-t border-foreground/40" />
      <span aria-hidden className="absolute right-0 top-0 size-3 border-r border-t border-foreground/40" />
      <span aria-hidden className="absolute bottom-0 left-0 size-3 border-b border-l border-foreground/40" />
      <span aria-hidden className="absolute bottom-0 right-0 size-3 border-b border-r border-foreground/40" />

      {/* dotted field */}
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(circle,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:18px_18px]"
      />

      {/* play + label */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
        <span className="flex size-14 items-center justify-center rounded-full border border-border bg-background/60 backdrop-blur-sm">
          <Play className="size-5 translate-x-0.5 text-foreground" />
        </span>
        <span className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground/70">
          Demo · coming soon
        </span>
      </div>

      {/* timecode flourish */}
      <span
        aria-hidden
        className="absolute bottom-3 right-3 font-mono text-[0.65rem] tabular-nums text-muted-foreground/40"
      >
        00:00 / 00:00
      </span>
    </div>
  );
}
