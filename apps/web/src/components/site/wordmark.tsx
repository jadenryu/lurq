import Link from "next/link";
import { BRAND_TAGLINE, WORDMARK } from "@/content/copy";

/**
 * The lurq mark: two interlocking chevrons, one pointing back and one forward.
 *
 * Traced off public/logos/logo.png rather than invented. That file is a 2000px
 * raster on an opaque black square, so it cannot sit on the footer photograph or
 * on the nav pill without carrying its own background with it, and it cannot
 * take currentColor. Every coordinate below is the measured centreline from the
 * original, scaled into a 22x30 box: the arms run at 45 degrees, the stroke is
 * 219px horizontal in the source, and the two chevrons are the same shape offset
 * diagonally.
 *
 * The back chevron is the same ink at 52%, which is what the grey in the
 * original works out to against its white. Keeping it as one colour at two
 * opacities means the mark tints correctly anywhere.
 */
export function Mark({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={(size * 22) / 30}
      height={size}
      viewBox="0 0 22 30"
      fill="none"
      aria-hidden
      focusable="false"
    >
      {/* Back: points forward, sits down and to the right. */}
      <path
        d="M7.72 9.1 16.84 18.24 7.72 27.4"
        stroke="currentColor"
        strokeOpacity="0.52"
        strokeWidth="3.72"
        strokeLinecap="butt"
        strokeLinejoin="miter"
      />
      {/* Front: points back, sits up and to the left. */}
      <path
        d="M14.24 2.56 5.12 11.72 14.24 20.88"
        stroke="currentColor"
        strokeWidth="3.72"
        strokeLinecap="butt"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

/**
 * `href` makes it a link; leave it off for the footer, where the lockup is a
 * label rather than a way back to a page you are already on.
 */
export function Wordmark({
  href,
  size = 16,
  className,
  tagline = false,
}: {
  href?: string;
  size?: number;
  className?: string;
  tagline?: boolean;
}) {
  const lockup = (
    <span className="inline-flex items-center gap-2">
      <span className="text-ink">
        <Mark size={size} />
      </span>
      <span
        className="font-mono font-medium tracking-[-0.01em] text-ink"
        style={{ fontSize: size + 1 }}
      >
        {WORDMARK}
      </span>
    </span>
  );

  if (!href) {
    return (
      <span className={className}>
        {lockup}
        {tagline ? (
          <span className="mt-3 block font-mono text-[11px] tracking-[0.08em] text-ink-3">
            {BRAND_TAGLINE}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <Link
      href={href}
      aria-label={WORDMARK}
      className={`inline-flex items-center transition-[opacity] hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-mark ${className ?? ""}`}
      style={{ transitionDuration: "var(--dur-hover)" }}
    >
      {lockup}
    </Link>
  );
}
