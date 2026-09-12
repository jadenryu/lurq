import { ImageResponse } from "next/og";

import {
  EYEBROW_LICENSE,
  EYEBROW_NPM,
  EYEBROW_VERSION,
  HEADLINE_LINE_1,
  HEADLINE_LINE_2,
  INSTALL_COMMAND,
} from "@/content/copy";
import { ogFonts } from "@/lib/og-fonts";

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
 * THE NAME IS ON THE CARD. It was not, for the card's whole life: the only
 * "lurq" on it was inside the npm chip. X prints the domain in grey under the
 * image, so the brand was legible but never designed, and a card that has to
 * borrow its identity from the browser chrome around it is doing half its job.
 * Wordmark top-left, chip top-right, and the rail at the bottom closes the
 * frame with the command and the domain.
 *
 * THE LEAD PARAGRAPH IS NOT HERE, deliberately. It is 23 words, it wraps to
 * three lines at this width, and a timeline thumbnail is read at about 400px
 * wide where those lines are illegible. Twitter prints the description under
 * the image anyway, so putting it in the picture spends the card's whole middle
 * on text that is about to appear again in a more readable place.
 *
 * SATORI IS NOT A BROWSER, and its limits shape this file.
 *
 * FONTS: see lib/og-fonts. Short version — @vercel/og's bundled Geist Regular
 * was rendering every weight on this card, so the headline and the install pill
 * were the same physical weight with the difference faked. Real 500 and 700 now
 * come from static instances cut from the upstream variable font.
 *
 * THE WORD GAPS ARE SATORI'S AND ARE NOT WORTH CHASING. Some words are measured
 * a few pixels wider than their ink, so a gap after a long one reads loose
 * ("verification layer"). Ruled out, each by rendering it: the source strings
 * (single spaces, checked by codepoint), synthesised weight (persists with real
 * 500), `letter-spacing` at every value including `normal`, `white-space`
 * (nowrap/pre/pre-wrap/default), splitting the line into per-word flex children
 * with an explicit gap (the extra space is INSIDE the word's own box), and the
 * `liga`/`calt`/`kern` features. It is Satori's own text measurement. At the
 * ~500px a timeline actually renders this, it is invisible.
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

/** The canonical host, as the card's own sign-off. */
const DOMAIN = "lurq.run";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          /* Three rails rather than a centred stack: the old card floated its
             content in the middle and left the corners empty, which at
             thumbnail size read as a slide rather than a card. */
          justifyContent: "space-between",
          backgroundColor: GROUND,
          color: INK,
          fontFamily: "Geist",
          /* ON THE ROOT, NOT IN TWO DIVS. The blooms were a pair of absolutely
             positioned boxes each carrying a radial gradient, and Satori does
             not resolve those the way a browser does: every box showed its own
             bounds as a hard band straight across the card, at any size, fade
             distance or opacity. Painted on the card itself there is no box to
             see the edge of. rgba rather than a separate opacity for the same
             reason: one layer, one value, nothing to composite wrong. */
          backgroundImage: `radial-gradient(circle at 18% 12%, ${BLOOM_FROM_SOFT}, transparent 55%), radial-gradient(circle at 86% 92%, ${BLOOM_TO_SOFT}, transparent 55%)`,
          padding: "64px 70px",
        }}
      >
        {/* Top rail: who this is, and how current it is. The chip is the one
            element that dates the card, which is why it is read from the
            registry rather than typed. */}
        <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
          <span style={{ fontSize: 40, fontWeight: 700, letterSpacing: "-0.03em" }}>lurq</span>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginLeft: "auto",
              border: `1px solid ${EDGE}`,
              borderRadius: 999,
              padding: "8px 18px 8px 8px",
              fontSize: 19,
            }}
          >
            <span
              style={{ background: SURFACE_2, borderRadius: 999, padding: "4px 13px", color: INK }}
            >
              {EYEBROW_VERSION}
            </span>
            <span style={{ color: INK_3 }}>
              {EYEBROW_NPM} · {EYEBROW_LICENSE}
            </span>
          </div>
        </div>

        {/* The headline, broken by hand on the same two lines the page breaks
            it on.

            `nowrap` on each line, and a size chosen so the longer of them fits
            at this width. Without it the second line wrapped to a third and the
            card read as broken type: the whole reason these are two hand-broken
            strings rather than one sentence is that the break is a decision,
            and letting Satori re-break them throws that decision away.

            Left-aligned now rather than centred, so it shares an edge with the
            wordmark above it and the command below. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontSize: 60,
            fontWeight: 500,
            lineHeight: 1.14,
            letterSpacing: "-0.03em",
          }}
        >
          <div style={{ whiteSpace: "nowrap" }}>{HEADLINE_LINE_1}</div>
          <div style={{ whiteSpace: "nowrap" }}>{HEADLINE_LINE_2}</div>
        </div>

        {/* Bottom rail: the one thing a reader can act on, and where to do it.
            The command is the hero's solid button, and the reason the lead
            paragraph came out to make room. */}
        <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              background: INK,
              color: GROUND,
              borderRadius: 999,
              padding: "15px 32px",
              fontWeight: 700,
              fontSize: 25,
            }}
          >
            <span style={{ color: INK_2 }}>$</span>
            {INSTALL_COMMAND}
          </div>
          <span style={{ marginLeft: "auto", fontSize: 20, color: INK_3 }}>{DOMAIN}</span>
        </div>
      </div>
    ),
    { ...size, fonts: ogFonts },
  );
}
