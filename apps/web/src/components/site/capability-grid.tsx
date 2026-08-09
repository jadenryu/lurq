"use client";

import { useEffect, useRef, useState } from "react";

import { FIGURES } from "@/components/site/capability-figures";
import {
  CAPABILITIES,
  CAPABILITIES_HEAD,
  type Capability,
} from "@/content/capabilities";

/**
 * The tool surface as a bento: five cards, two wide over three narrow.
 *
 * The card is mostly picture. Its figure fills the whole tile and the words sit
 * over the bottom of it on a blurred plate, which is the arrangement that makes
 * the section read as a set of instruments rather than as a table of features.
 * The previous pass had this inverted, a small diagram above four lines of
 * prose, and no amount of tuning the diagram fixes a card that is 90% text.
 *
 * The outer corners are rounded and the inner ones are not, so the five tiles
 * read as one slab that has been cut, rather than as five floating cards.
 *
 * Reveal is the page's own: one IntersectionObserver, a CSS schedule in
 * --reveal-at, no animation library. framer-motion and clsx, which the
 * reference used, would both have been new dependencies for a fade and a
 * class join that `cn` already does.
 */

type Span = { grid: string; corner: string };

/**
 * Placement lives here rather than in the content file: which tile is wide is a
 * layout decision, and content should not have to know the column count.
 * Order is the reading order: real, together, node, api, stack.
 */
const SPANS: Span[] = [
  { grid: "min-[900px]:col-span-3", corner: "min-[900px]:rounded-tl-[16px]" },
  { grid: "min-[900px]:col-span-3", corner: "min-[900px]:rounded-tr-[16px]" },
  { grid: "min-[900px]:col-span-2", corner: "min-[900px]:rounded-bl-[16px]" },
  { grid: "min-[900px]:col-span-2", corner: "" },
  { grid: "min-[900px]:col-span-2", corner: "min-[900px]:rounded-br-[16px]" },
];

function CapabilityCard({ feature, index }: { feature: Capability; index: number }) {
  const Figure = FIGURES[feature.figure];
  const span = SPANS[index] ?? { grid: "", corner: "" };

  return (
    <article
      data-card
      style={{ ["--reveal-at" as string]: `${120 + index * 80}ms` }}
      className={[
        "room-cap-card group relative isolate flex flex-col overflow-hidden",
        "rounded-[10px]",
        span.grid,
        span.corner,
      ].join(" ")}
    >
      {/* The picture. Sliced rather than stretched, so a wide tile crops the
          figure instead of distorting its stroke weights. */}
      <div className="room-cap-art relative h-[180px] shrink-0 min-[900px]:h-[216px]">
        <Figure id={`cap-${feature.figure}`} />
      </div>

      {/* The plate. Pulled up over the foot of the figure and blurred, so the
          picture continues behind the words instead of stopping above them. */}
      {/* -mt is 16% of the 216px figure, and the scrim in tokens.css is spent at
          84% to match. Deepen the overlap and the figure is still at strength
          under the hairline, which comes through the blur as a smear. */}
      <div className="room-cap-plate relative z-10 -mt-[34px] flex-1 px-5 pb-4 pt-4 min-[720px]:px-6 min-[720px]:pb-5">
        <p className="font-mono text-[11px] text-ink-3">{feature.backedBy}</p>
        <h3 className="mt-2 font-sans text-[17px] font-medium leading-snug text-ink">
          {feature.title}
        </h3>
        <p className="mt-2 max-w-[46ch] text-[13px] leading-[1.6] text-ink-2">{feature.body}</p>
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
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setPlaying(true);
          io.disconnect();
        }
      },
      { threshold: 0.12 },
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
          className="room-cap-grid mt-8 grid grid-cols-1 gap-3 min-[560px]:grid-cols-2 min-[900px]:grid-cols-6"
        >
          {CAPABILITIES.map((feature, i) => (
            <CapabilityCard key={feature.title} feature={feature} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}
