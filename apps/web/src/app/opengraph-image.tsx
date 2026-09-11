import { ImageResponse } from "next/og";

import {
  EYEBROW_LICENSE,
  EYEBROW_NPM,
  EYEBROW_VERSION,
  HEADLINE_LINE_1,
  HEADLINE_LINE_2,
  INSTALL_COMMAND,
} from "@/content/copy";

/**
 * The social card, which is the hero with the moving parts taken out.
 *
 * It used to be the wordmark over a tagline, and that is the card a project
 * makes before it has a page: correct, branded, and telling a scroller nothing
 * they could act on. Every element here is now the hero's own — the same chip,
 * the same two-line headline, the same install command, read from
 * content/copy.ts rather than retyped — so the card and the page it opens make
 * one impression rather than two, and a version bump cannot leave the card
 * advertising a release behind.
 *
 * THE LEAD PARAGRAPH IS NOT HERE, deliberately. It is 23 words, it wraps to
 * three lines at this width, and a timeline thumbnail is read at about 400px
 * wide where those lines are illegible. Twitter prints the description under
 * the image anyway, so putting it in the picture spends the card's whole middle
 * on text that is about to appear again in a more readable place.
 *
 * SATORI IS NOT A BROWSER, and two of its limits shape this file.
 *
 * FONTS: NEITHER OF OURS LOADS, and both fail differently. Satori reads ttf,
 * otf and woff but not woff2, and Geist ships here as a variable woff2
 * (lib/fonts.ts). Commit Mono is otf, which should work and does not: its
 * parser throws `ReferenceError: ltagTable is not defined` on this file and
 * takes the whole build down with it, since the card is prerendered.
 *
 * So everything is Satori's default grotesque, which is close enough to Geist
 * that the card still reads as ours. Converting Commit Mono to ttf would fix
 * the chip and the command pill, and it needs a font toolchain in the build for
 * two lines of type on one image. Not worth it until something else needs one.
 *
 * COLOUR: no oklch. The blooms are --bloom-from and --bloom-to from tokens.css
 * converted to sRGB once, here, with the source values named so the conversion
 * can be checked rather than trusted.
 */

export const alt = `lurq: ${HEADLINE_LINE_1} ${HEADLINE_LINE_2}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** tokens.css, the values a browser would compute. */
const GROUND = "#08080a";
const INK = "#f2f2ee";
const INK_2 = "#a0a099";
const INK_3 = "#82827a";
const EDGE = "#232328";
const SURFACE_2 = "#17171b";
/** oklch(0.646 0.222 41.116), at the strength GradientBlob paints it. */
const BLOOM_FROM_SOFT = "rgba(245, 73, 0, 0.20)";
/** oklch(0.488 0.243 264.376) */
const BLOOM_TO_SOFT = "rgba(20, 71, 230, 0.28)";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          backgroundColor: GROUND,
          /* ON THE ROOT, NOT IN TWO DIVS. The blooms were a pair of absolutely
             positioned boxes each carrying a radial gradient, and Satori does
             not resolve those the way a browser does: every box showed its own
             bounds as a hard band straight across the card, at any size, fade
             distance or opacity. Painted on the card itself there is no box to
             see the edge of. rgba rather than a separate opacity for the same
             reason: one layer, one value, nothing to composite wrong. */
          backgroundImage: `radial-gradient(circle at 18% 12%, ${BLOOM_FROM_SOFT}, transparent 55%), radial-gradient(circle at 86% 92%, ${BLOOM_TO_SOFT}, transparent 55%)`,
          padding: "0 60px",
        }}
      >
        {/* The version chip. It is the one element that dates the card, which
            is why it is read from the registry rather than typed. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            border: `1px solid ${EDGE}`,
            borderRadius: 999,
            padding: "9px 20px 9px 10px",
            fontSize: 21,
          }}
        >
          <span
            style={{
              background: SURFACE_2,
              borderRadius: 999,
              padding: "4px 14px",
              color: INK,
            }}
          >
            {EYEBROW_VERSION}
          </span>
          <span style={{ color: INK_3 }}>
            {EYEBROW_NPM} · {EYEBROW_LICENSE}
          </span>
        </div>

        {/* The headline, broken by hand on the same two lines the page breaks
            it on.

            `nowrap` on each line, and a size chosen so the longer of them fits
            at this width. Without it the second line wrapped to a third and the
            card read as broken type: the whole reason these are two hand-broken
            strings rather than one sentence is that the break is a decision,
            and letting Satori re-break them throws that decision away. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            marginTop: 40,
            fontSize: 62,
            fontWeight: 500,
            lineHeight: 1.14,
            letterSpacing: "-0.03em",
            /* The word gaps after "verification" and "everything" render a
               touch wide, and it is Satori's text layout with its fallback
               face, not this rule. Ruled out by trying it: removing the
               letter-spacing changed nothing, and so did dropping the weight to
               400 in case 500 was being synthesised. Left as the hero has it.
               Invisible at the size a timeline actually renders this. */
            color: INK,
            textAlign: "center",
          }}
        >
          <div style={{ whiteSpace: "nowrap" }}>{HEADLINE_LINE_1}</div>
          <div style={{ whiteSpace: "nowrap" }}>{HEADLINE_LINE_2}</div>
        </div>

        {/* The install command, as the hero's solid button. The one thing on
            the card a reader can act on, and the reason the lead came out to
            make room for it. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginTop: 48,
            background: INK,
            color: GROUND,
            borderRadius: 999,
            padding: "16px 34px",
            fontWeight: 700,
            fontSize: 26,
          }}
        >
          <span style={{ color: INK_2 }}>$</span>
          {INSTALL_COMMAND}
        </div>
      </div>
    ),
    { ...size },
  );
}
