import { cn } from "@/lib/utils";

/**
 * The blurred clip-path bloom, defined once.
 *
 * Lifted out of hero.tsx so the hero and the footer glow at the same strength.
 * They did not: the footer ran a separate component with a fully saturated
 * rainbow, which on this ground read as a light leak rather than as atmosphere.
 *
 * What is fixed here is the register — the polygon, the gradient, the blur and
 * the opacity. Callers only choose placement. That split is the point: a second
 * call site that wants its own colour is not a new prop, it is the thing that
 * made the footer look like a different site.
 *
 * aria-hidden and pointer-events-none throughout. It is weather, not content.
 */

/** The clipped polygon from hero-1.tsx, identical everywhere; placement differs. */
export const BLOB_CLIP =
  "polygon(74.1% 44.1%, 100% 61.6%, 97.5% 26.9%, 85.5% 0.1%, 80.7% 2%, 72.5% 32.5%, 60.2% 62.4%, 52.4% 68.1%, 47.5% 58.3%, 45.2% 34.5%, 27.5% 76.7%, 0.1% 64.9%, 17.9% 100%, 27.6% 76.8%, 76.1% 97.7%, 74.1% 44.1%)";

export const BLOB_GRADIENT =
  "linear-gradient(to top right, oklch(0.646 0.222 41.116), oklch(0.488 0.243 264.376))";

type Props = {
  /** Placement of the clipping window. */
  outer?: string;
  /** Placement of the blob inside it. */
  inner?: string;
};

export function GradientBlob({ outer, inner }: Props) {
  return (
    <div
      aria-hidden
      className={cn(
        // z-0 rather than the source's -z-10: neither the hero nor the footer is
        // a stacking context, so a negative index escapes the section and lands
        // behind the page background instead of behind the type.
        "pointer-events-none absolute z-0 transform-gpu overflow-hidden blur-3xl",
        outer,
      )}
    >
      <div
        style={{ clipPath: BLOB_CLIP, background: BLOB_GRADIENT }}
        className={cn(
          "relative aspect-[1155/678] w-[36.125rem] max-w-none -translate-x-1/2 opacity-30 sm:w-[72.1875rem]",
          inner,
        )}
      />
    </div>
  );
}
