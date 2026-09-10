"use client";

import { useEffect, useRef, useState } from "react";

import { FIGURES } from "@/components/site/capability-figures";
import { CallPanel } from "@/components/site/call-panel";
import {
  CAPABILITIES,
  CAPABILITIES_HEAD,
  type Capability,
} from "@/content/capabilities";

/**
 * The tool surface as a 2x2: four cards, one question each.
 *
 * The card is mostly picture. Its figure fills the whole tile and the words sit
 * over the bottom of it on a blurred plate, which is the arrangement that makes
 * the section read as a set of instruments rather than as a table of features.
 * The previous pass had this inverted, a small diagram above four lines of
 * prose, and no amount of tuning the diagram fixes a card that is 90% text.
 *
 * The four tiles are BUTTED TOGETHER, no gap, and only the outer four corners
 * are rounded, so the grid is one slab that has been cut into quarters rather
 * than four cards that happen to be adjacent. Which corner belongs to which tile
 * is nth-child in tokens.css rather than a class per card: it is a property of
 * the arrangement, and the card should not have to know its own index to be
 * drawn correctly.
 *
 * The bento this replaces was five tiles, two wide over three narrow. With the
 * fifth card gone (see content/capabilities.ts) that shape left a hole, and a
 * bento with a gap in it reads as a tile that failed to load.
 *
 * Reveal is the page's own: one IntersectionObserver, a CSS schedule in
 * --reveal-at, no animation library. framer-motion and clsx, which the
 * reference used, would both have been new dependencies for a fade and a
 * class join that `cn` already does.
 *
 * THE CARDS TURN OVER. The front asks the question; the back is the call an
 * agent makes to answer it, in a terminal, with a copy button and a second
 * button that copies the same call wrapped in enough context to paste into a
 * chat. This replaces ProductShowcase, which racked all ten tools up in a
 * ten-tab panel immediately below this grid and answered the same five
 * questions a second time at ten times the length. The call belongs on the back
 * of the card that raises the question.
 *
 * The flip is a CSS rotateY on a preserve-3d wrapper, two faces, backface
 * hidden. No library, and no height animation: both faces are absolutely
 * positioned over a card whose height comes from the grid, so nothing reflows
 * and the section cannot shift as somebody clicks through it.
 *
 * `inert` on the face that is turned away is doing the accessibility work.
 * `backface-visibility: hidden` hides a face from the eye and from nobody else:
 * without inert, the buttons on the back are in the tab order while the card is
 * showing its front, and a keyboard visitor tabs into controls that are not on
 * screen.
 */

function CapabilityCard({ feature, index }: { feature: Capability; index: number }) {
  const Figure = FIGURES[feature.figure];
  const [flipped, setFlipped] = useState(false);

  // Escape turns the card back over. Bound only while this card is facing its
  // back: both faces of all four cards are mounted at all times, so a listener
  // inside the panel would be four listeners, three of them with nothing to
  // close.
  useEffect(() => {
    if (!flipped) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFlipped(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flipped]);

  return (
    <article
      data-card
      style={{ ["--reveal-at" as string]: `${120 + index * 80}ms` }}
      className="room-cap-card group relative isolate flex flex-col overflow-hidden rounded-[10px]"
    >
      <div data-flipped={flipped || undefined} className="room-cap-flip">
        {/* ── FRONT ──────────────────────────────────────────────────────────
            The whole face is the target, not a link in the corner of it: the
            affordance is "this card turns over", and a card whose picture and
            heading are inert beside a small link is a card most people never
            turn.

            A transparent button OVER the face rather than one wrapped AROUND
            it. A `button` may only contain phrasing content, and this face is a
            heading and two paragraphs; nesting them inside one is invalid HTML
            and assistive technology flattens the lot into a single label. The
            overlay keeps the semantics of a heading and a paragraph and still
            makes every pixel clickable. */}
        <div inert={flipped} className="room-cap-face room-cap-front">
          {/* The picture. Sliced rather than stretched, so a wide tile crops the
              figure instead of distorting its stroke weights. */}
          <div className="room-cap-art relative h-[180px] shrink-0 min-[900px]:h-[216px]">
            <Figure id={`cap-${feature.figure}`} />
          </div>

          {/* The plate. Pulled up over the foot of the figure and blurred, so the
              picture continues behind the words instead of stopping above them. */}
          {/* -mt is 16% of the 216px figure, and the scrim in tokens.css is spent
              at 84% to match. Deepen the overlap and the figure is still at
              strength under the hairline, which comes through the blur as a
              smear. */}
          <div className="room-cap-plate relative z-10 -mt-[34px] flex-1 px-5 pb-4 pt-4 text-left min-[720px]:px-6 min-[720px]:pb-5">
            <p className="font-mono text-[11px] text-ink-3">{feature.backedBy}</p>
            <h3 className="mt-2 font-sans text-[17px] font-medium leading-snug text-ink">
              {feature.title}
            </h3>
            <p className="mt-2 max-w-[46ch] text-[13px] leading-[1.6] text-ink-2">
              {feature.body}
            </p>
            <p aria-hidden className="room-cap-turn">
              See the call
              <span className="pl-1">→</span>
            </p>
          </div>

          <button
            type="button"
            onClick={() => setFlipped(true)}
            className="room-cap-hit"
          >
            <span className="sr-only">Show the call behind: {feature.title}</span>
          </button>
        </div>

        {/* ── BACK ───────────────────────────────────────────────────────────
            The same arrangement as the front, for the same reason: the face is
            the target. Its hit layer sits over the panel and under the two copy
            buttons, so the card turns back over from anywhere except the two
            places where a click means something else. */}
        <div inert={!flipped} className="room-cap-face room-cap-back">
          <CallPanel call={feature.call} question={feature.title} />
          <button
            type="button"
            onClick={() => setFlipped(false)}
            className="room-cap-hit"
          >
            <span className="sr-only">Back to the question: {feature.title}</span>
          </button>
        </div>
      </div>
    </article>
  );
}

export function CapabilityGrid() {
  const ref = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Never gate on a visible RATIO. The cards are `opacity: 0` with their
    // animation paused until `data-playing` lands, so this observer is the only
    // thing that can make the section legible — and a ratio threshold is a
    // condition the layout can make unsatisfiable. `threshold: 0.12` asks for
    // 12% of the section on screen at once; the grid is five stacked cards on a
    // phone, and once a section is taller than ~8x the viewport the maximum
    // achievable ratio drops below the threshold and the callback NEVER fires.
    // The section then stays black forever. That is the mobile bug, and it is
    // invisible on a desktop viewport because the same section fits the screen.
    //
    // `threshold: 0` fires on any intersection at all, which is what "reveal
    // when it comes into view" actually means. The negative bottom margin keeps
    // the original intent — start slightly before the top edge — without ever
    // becoming unreachable.
    const io = new IntersectionObserver(
      (entries) => {
        // `isIntersecting` alone is not enough. IntersectionObserver reports the
        // current state once on observe() and then only on change — so if the
        // visitor has ALREADY scrolled past this section by the time React
        // hydrates and this effect runs, the first callback says "not
        // intersecting" (the element is above the viewport) and no further
        // callback ever comes. The section stays black for the rest of the
        // session, and only for people who scrolled quickly, which is what made
        // this look intermittent.
        //
        // `boundingClientRect.top < 0` is "we are past it", which for a
        // reveal-on-scroll means the same thing as "it has been seen".
        const reached = entries.some(
          (e) => e.isIntersecting || e.boundingClientRect.top < 0,
        );
        if (reached) {
          setPlaying(true);
          io.disconnect();
        }
      },
      { threshold: 0, rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    // py-24/py-32 is the page's section rhythm; see (marketing)/page.tsx. This
    // was py-16/py-20 and sat visibly tighter than the sections either side.
    <section id="tools" className="w-full px-4 py-24 min-[768px]:px-6 min-[900px]:py-32">
      <div className="mx-auto w-full max-w-[1180px]">
        {/* Headline only. The mono small-caps kicker that opened this and every
            other section is gone: six of them down one page was a pattern, and a
            pattern that says nothing is decoration. The cards state their own
            questions, so anything above them is explaining what is about to be
            shown. */}
        <h2
          className="max-w-[24ch] font-sans font-medium text-ink"
          style={{
            fontSize: "clamp(1.6rem, 3vw, 2.25rem)",
            lineHeight: 1.12,
            letterSpacing: "-0.028em",
          }}
        >
          {CAPABILITIES_HEAD}
        </h2>

        <div
          ref={ref}
          data-playing={playing ? "true" : undefined}
          className="room-cap-grid mt-8 grid grid-cols-1 gap-3 min-[560px]:grid-cols-2"
        >
          {CAPABILITIES.map((feature, i) => (
            <CapabilityCard key={feature.title} feature={feature} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}
