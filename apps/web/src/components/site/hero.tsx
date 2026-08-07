import { CopyCommandButton } from "@/components/site/copy-command-button";
import { GradientBlob } from "@/components/site/gradient-blob";
import {
  CTA_DOCS,
  EYEBROW_LICENSE,
  EYEBROW_NPM,
  EYEBROW_VERSION,
  HEADLINE_LINE_1,
  HEADLINE_LINE_2,
  INSTALL_COMMAND,
  LEAD,
  NPM_PACKAGE_URL,
} from "@/content/copy";
import { DOCS_URL } from "@/lib/site-links";

/**
 * Type on a gradient field. Nothing else.
 *
 * The spacing here is the design. An earlier pass took ~1,400px to get from the
 * nav to the artifact and every gap was 30 to 40% too large; these values are
 * the fix and they are deliberately tight.
 *
 * The reveal schedule is carried per element as --reveal-at, so the sequence
 * reads in source order rather than hiding in a stylesheet.
 *
 * The background is the two blurred clip-path gradient blobs from hero-1.tsx,
 * one off the top edge and one off the bottom.
 *
 * TWO THINGS THAT USED TO BE HERE.
 *
 * The four L-shaped registration marks, 24px inside the section edges. They read
 * as stray brackets floating in the corners of the viewport rather than as a
 * crop frame, which is what they were for. Deleted, along with the matching set
 * inside every capability figure.
 *
 * The product video slot, a dashed 16:9 box captioned PRODUCT VIDEO. It has
 * moved to (marketing)/page.tsx, commented out, where the middle of the page is.
 * Uncomment that block when the video exists. With it gone the hero is type on a
 * field, so the section carries its own bottom padding now instead of borrowing
 * the video's top margin.
 */

/** The two blooms, one off the top edge and one off the bottom. */
function GradientField() {
  return (
    <>
      <GradientBlob
        outer="inset-x-0 -top-40 min-h-screen sm:-top-80"
        inner="left-[calc(50%-11rem)] min-h-screen rotate-[30deg] sm:left-[calc(50%-30rem)]"
      />
      <GradientBlob
        outer="inset-x-0 top-[calc(100%-13rem)] min-h-screen sm:top-[calc(100%-30rem)]"
        inner="left-[calc(50%+3rem)] min-h-screen sm:left-[calc(50%+36rem)]"
      />
    </>
  );
}

export function Hero() {
  return (
    // NO min-height, AND NOT THE GENERIC SECTION RHYTHM. Both were tried here
    // and both were wrong, for the same underlying reason.
    //
    // `min-h-[calc(100svh-68px)]` with `items-center` centred the type, but the
    // leftover height became dead space *below* the CTA that then stacked on top
    // of this section's pb and the marquee's pt: ~100px of centring slack + 128
    // + 128, so about 350px of nothing between the install button and the logo
    // band. Centred, and visibly broken.
    //
    // py-24/py-32, the rhythm every other section uses, is also wrong at this one
    // seam. The hero and the band under it are one composition, not two sections
    // that happen to be adjacent, so the gap between them has to be smaller than
    // the gap between real sections. ide-marquee carries the matching tighter
    // pt for the same reason.
    //
    // The top pad is a clamp rather than a fixed 76px so the type sits lower in
    // the fold on a tall window, which is the "more centred" part, without ever
    // pushing the CTA off a short one.
    <section className="relative w-full pb-16 pt-[clamp(88px,13vh,168px)] min-[900px]:pb-20">
      <GradientField />

      <div className="relative z-10 mx-auto w-full max-w-[1080px] px-4 min-[768px]:px-6">
        <div className="flex flex-col items-center text-center">
          {/* No top margin any more: the section centres the whole block, so a
              76px offset here would push it off centre by exactly that much.
              One chip rather than a rule with text floating in the gap. The
              whole thing is the proof link: the version it states is checkable
              in one click, which is the only reason to print a version here. */}
          <div data-reveal style={{ ["--reveal-at" as string]: "200ms" }}>
            <a
              href={NPM_PACKAGE_URL}
              target="_blank"
              rel="noopener"
              className="room-chip group focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark"
            >
              <span className="room-chip-inner font-mono text-[11px]">
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-ink">
                  {EYEBROW_VERSION}
                </span>
                <span className="text-ink-3">
                  {EYEBROW_NPM}
                  <span aria-hidden className="px-1.5 text-edge-lit">
                    ·
                  </span>
                  {EYEBROW_LICENSE}
                </span>
                <span
                  aria-hidden
                  className="text-[10px] text-ink-3 transition-transform group-hover:translate-x-0.5"
                  style={{ transitionDuration: "var(--dur-hover)" }}
                >
                  ↗
                </span>
              </span>
            </a>
          </div>

          {/* Two lines, broken by hand. `text-wrap: balance` would pick its own
              break and it picks a worse one: three lines at 1440. */}
          <h1
            className="mt-[26px] max-w-[980px] font-sans font-medium text-ink"
            style={{
              fontSize: "clamp(2.2rem, 5vw, 3.4rem)",
              lineHeight: 1.06,
              letterSpacing: "-0.03em",
            }}
          >
            <span
              data-reveal
              style={{ ["--reveal-at" as string]: "320ms" }}
              className="block"
            >
              {HEADLINE_LINE_1}
            </span>
            <span
              data-reveal
              style={{ ["--reveal-at" as string]: "430ms" }}
              className="block"
            >
              {HEADLINE_LINE_2}
            </span>
          </h1>

          <p
            data-reveal
            className="mt-[22px] max-w-[60ch] text-ink-2"
            style={{
              ["--reveal-at" as string]: "600ms",
              fontSize: "clamp(15px, 1.5vw, 16.5px)",
              lineHeight: 1.6,
            }}
          >
            {LEAD}
          </p>

          <div
            data-reveal
            style={{ ["--reveal-at" as string]: "730ms" }}
            className="mt-[30px] flex flex-wrap items-center justify-center gap-3"
          >
            <CopyCommandButton
              command={INSTALL_COMMAND}
              label={INSTALL_COMMAND}
              variant="solid"
            />
            <a
              href={DOCS_URL}
              className="inline-flex h-11 shrink-0 items-center rounded-md border border-edge px-5 text-[14px] text-ink-2 transition-[color,border-color] hover:border-edge-lit hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark"
              style={{ transitionDuration: "var(--dur-hover)" }}
            >
              {CTA_DOCS}
            </a>
          </div>

        </div>
      </div>
    </section>
  );
}
