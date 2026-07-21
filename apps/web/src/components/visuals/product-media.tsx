import { cn } from "@/lib/utils";

type Chrome = "brackets" | "window" | "none";
type Aspect = "video" | "wide" | "square" | "auto";

const ASPECT: Record<Aspect, string> = {
  video: "aspect-video",
  wide: "aspect-[21/9]",
  square: "aspect-square",
  auto: "",
};

/**
 * Reusable product-media frame. Drop in a real screen recording (webm/mp4) or a
 * GIF via `src`; until one exists, pass an animated in-browser mock as
 * `children` and it renders inside the same frame with zero layout change.
 *
 * Priority: src (video) > children (mock) > built-in "coming soon" placeholder.
 * See public/media/README.md for how to record and name clips.
 */
export function ProductMedia({
  src,
  poster,
  gif,
  aspect = "video",
  chrome = "brackets",
  label,
  caption,
  title,
  className,
  children,
}: {
  /** Path to a looping clip, e.g. "/media/hero-demo.webm". */
  src?: string;
  poster?: string;
  /** Optional GIF/PNG fallback path used when no <video> src is given. */
  gif?: string;
  aspect?: Aspect;
  chrome?: Chrome;
  /** Corner/gutter label, e.g. "lurq · mcp". */
  label?: string;
  /** Small mono caption pinned bottom-right. */
  caption?: string;
  /** Title shown in the window chrome bar. */
  title?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const hasVideo = Boolean(src);
  const hasGif = !hasVideo && Boolean(gif);
  const hasMock = !hasVideo && !hasGif && Boolean(children);

  return (
    <figure
      className={cn(
        "group relative overflow-hidden border border-border/70 bg-card/20",
        chrome === "window" ? "rounded-[var(--radius-lg)]" : "rounded-[var(--radius-lg)]",
        className,
      )}
    >
      {chrome === "window" ? (
        <div className="flex items-center gap-2 border-b border-border/70 bg-background/50 px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-[#e08b7a]/85" aria-hidden />
          <span className="size-2.5 rounded-full bg-[#e6c07a]/85" aria-hidden />
          <span className="size-2.5 rounded-full bg-[#7dcea0]/85" aria-hidden />
          {title ? (
            <span className="ml-3 truncate font-mono text-[0.7rem] text-muted-foreground/70">
              {title}
            </span>
          ) : null}
        </div>
      ) : null}

      {chrome === "brackets" ? (
        <>
          <span aria-hidden className="pointer-events-none absolute left-0 top-0 z-10 size-3 border-l border-t border-foreground/40" />
          <span aria-hidden className="pointer-events-none absolute right-0 top-0 z-10 size-3 border-r border-t border-foreground/40" />
          <span aria-hidden className="pointer-events-none absolute bottom-0 left-0 z-10 size-3 border-b border-l border-foreground/40" />
          <span aria-hidden className="pointer-events-none absolute bottom-0 right-0 z-10 size-3 border-b border-r border-foreground/40" />
        </>
      ) : null}

      <div className={cn("relative w-full", ASPECT[aspect])}>
        {hasVideo ? (
          <video
            className="absolute inset-0 size-full object-cover"
            src={src}
            poster={poster}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
          />
        ) : hasGif ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={gif}
            alt={label ?? "lurq product demo"}
            className="absolute inset-0 size-full object-cover"
          />
        ) : hasMock ? (
          // "auto" aspect: let the mock define its own height (flow layout).
          // Fixed aspects: fill the reserved box.
          aspect === "auto" ? (
            <div>{children}</div>
          ) : (
            <div className="absolute inset-0">{children}</div>
          )
        ) : (
          <ComingSoon label={label} />
        )}
      </div>

      {label ? (
        <figcaption className="sr-only">{label}</figcaption>
      ) : null}

      {caption ? (
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-3 right-3 z-10 font-mono text-[0.65rem] tabular-nums text-muted-foreground/50"
        >
          {caption}
        </span>
      ) : null}
    </figure>
  );
}

function ComingSoon({ label }: { label?: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(circle,rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:18px_18px]"
      />
      <span className="relative font-mono text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground/60">
        {label ? `${label} · ` : ""}demo coming soon
      </span>
    </div>
  );
}
