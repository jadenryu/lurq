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
  NOTE_BEFORE_LINK,
  NOTE_LINK,
  NPM_PACKAGE_URL,
} from "@/content/copy";
import { DOCS_URL } from "@/lib/site-links";

/**
 * Type, marks, and the video slot.
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

/** Four 13px L-marks, 24px inside the hero box. Opacity only, and last. */
function RegistrationMarks() {
  const corner = "absolute size-[13px] border-edge";
  return (
    <div
      aria-hidden
      data-reveal="opacity"
      style={{ ["--reveal-at" as string]: "1200ms" }}
      className="pointer-events-none absolute inset-6 z-10 hidden min-[620px]:block"
    >
      <span className={`${corner} left-0 top-0 border-l border-t`} />
      <span className={`${corner} right-0 top-0 border-r border-t`} />
      <span className={`${corner} bottom-0 left-0 border-b border-l`} />
      <span className={`${corner} bottom-0 right-0 border-b border-r`} />
    </div>
  );
}

export function Hero() {
  return (
    <section className="relative w-full">
      <GradientField />
      <RegistrationMarks />

      <div className="relative z-10 mx-auto w-full max-w-[1080px] px-4 min-[768px]:px-6">
        <div className="flex flex-col items-center text-center">
          {/* nav bottom → eyebrow: 76px.
              One chip rather than a rule with text floating in the gap. The
              whole thing is the proof link: the version it states is checkable
              in one click, which is the only reason to print a version here. */}
          <div data-reveal style={{ ["--reveal-at" as string]: "200ms" }} className="mt-[76px]">
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

          {/* The qualifier, above the fold. Small, but not hidden. */}
          <p
            data-reveal
            style={{ ["--reveal-at" as string]: "830ms" }}
            className="mt-[14px] font-mono text-[12px] text-ink-3"
          >
            {NOTE_BEFORE_LINK}
            <a
              href="#limits"
              className="underline decoration-edge-lit underline-offset-4 transition-[color,text-decoration-color] hover:text-mark hover:decoration-mark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark"
              style={{ transitionDuration: "var(--dur-hover)" }}
            >
              {NOTE_LINK}
            </a>
          </p>
        </div>
      </div>

      {/* Reserved for the product video. Deliberately a labelled empty box and
          not a placeholder image: nothing here should look finished until the
          real thing lands. Delete the dashes and drop the player straight in. */}
      <div className="relative z-10 mt-[clamp(56px,8vh,96px)] px-4 min-[768px]:px-6">
        <div className="mx-auto flex aspect-video w-full max-w-[1000px] items-center justify-center rounded-2xl border border-dashed border-edge">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-3">
            Product video
          </p>
        </div>
      </div>
    </section>
  );
}
