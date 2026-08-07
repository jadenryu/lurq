"use client";

import { useEffect, useRef, useState } from "react";

import {
  CAPABILITIES,
  CAPABILITIES_BODY,
  CAPABILITIES_HEAD_1,
  CAPABILITIES_HEAD_2,
  CAPABILITIES_LABEL,
  type Capability,
} from "@/content/capabilities";

/**
 * The tool surface, as the questions it answers.
 *
 * Two things about the reference grid did not survive contact with this app and
 * both were load-bearing:
 *
 *  1. It seeded each card's pattern with Math.random() *during render*. Under
 *     SSR that draws one set of squares on the server and a different set on the
 *     client, which is a hydration mismatch on every paint. The offsets are
 *     derived from the card's index here instead: same input, same output, both
 *     sides.
 *
 *  2. It reached for an animation library to fade the grid in. This page already
 *     reveals on scroll (see agent-session.tsx) with an IntersectionObserver and
 *     a CSS schedule, so that is what this uses. No dependency was added.
 *
 * Colours come from the page's own tokens rather than the shadcn defaults the
 * reference used, so the cards sit on --surface with --edge rules instead of
 * importing a second palette.
 */

/**
 * Deterministic stand-in for the reference's Math.random(). A cheap integer hash
 * of (card, square) folded into the same ranges it used: x in 7..10, y in 1..6.
 * It only has to look unpatterned, not be unpredictable.
 */
function squaresFor(card: number): [number, number][] {
  return Array.from({ length: 5 }, (_, i) => {
    const h = Math.imul(card * 73 + i * 149 + 17, 2654435761) >>> 0;
    return [7 + ((h >>> 4) % 4), 1 + ((h >>> 12) % 6)] as [number, number];
  });
}

function CardPattern({ card }: { card: number }) {
  // useId would be stable too, but the index already is, and it keeps the
  // pattern id readable in the DOM.
  const id = `cap-grid-${card}`;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 [mask-image:radial-gradient(farthest-side_at_top_right,white,transparent)]"
    >
      <svg className="absolute inset-0 h-full w-full">
        <defs>
          <pattern id={id} width={20} height={20} patternUnits="userSpaceOnUse" x="-12" y="4">
            <path d="M.5 20V.5H20" fill="none" stroke="var(--edge-lit)" strokeOpacity="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" strokeWidth={0} fill={`url(#${id})`} />
        <svg x="-12" y="4" className="overflow-visible">
          {squaresFor(card).map(([x, y], i) => (
            <rect
              key={i}
              strokeWidth={0}
              width={21}
              height={21}
              x={x * 20}
              y={y * 20}
              fill="var(--ink)"
              fillOpacity="0.04"
            />
          ))}
        </svg>
      </svg>
    </div>
  );
}

function CapabilityCard({ feature, index }: { feature: Capability; index: number }) {
  return (
    <div
      data-card
      style={{ ["--reveal-at" as string]: `${140 + index * 90}ms` }}
      className="room-cap-card relative overflow-hidden p-6 min-[720px]:p-7"
    >
      <CardPattern card={index} />

      <feature.icon
        aria-hidden
        strokeWidth={1}
        className="relative z-10 size-6 text-ink-3 transition-colors group-hover:text-ink-2"
      />

      <h3 className="relative z-10 mt-10 font-sans text-[15px] font-medium text-ink">
        {feature.title}
      </h3>
      <p className="relative z-10 mt-2.5 text-[13px] leading-[1.65] text-ink-2">{feature.body}</p>

      {/* The receipt. Every name here is callable today, which is what lets the
          card above it be worded as a plain statement. */}
      <p className="relative z-10 mt-4 font-mono text-[11px] text-ink-3">{feature.backedBy}</p>
    </div>
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
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section id="tools" className="w-full px-4 py-24 min-[768px]:px-6 min-[900px]:py-32">
      <div className="mx-auto w-full max-w-[1100px]">
        <div className="mx-auto max-w-[62ch] text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-3">
            {CAPABILITIES_LABEL}
          </p>
          <h2
            className="mt-5 font-sans font-medium text-ink"
            style={{
              fontSize: "clamp(1.75rem, 3.4vw, 2.5rem)",
              lineHeight: 1.1,
              letterSpacing: "-0.028em",
            }}
          >
            <span className="block">{CAPABILITIES_HEAD_1}</span>
            <span className="block text-ink-3">{CAPABILITIES_HEAD_2}</span>
          </h2>
          <p className="mt-6 text-[15px] leading-[1.65] text-ink-2">{CAPABILITIES_BODY}</p>
        </div>

        {/* Dashed rules rather than solid: this is a set of related answers, not
            six separate panels. Six cards divide evenly at 1, 2 and 3 columns,
            so no breakpoint leaves a hole in the grid. */}
        <div
          ref={ref}
          data-playing={playing ? "true" : undefined}
          className="room-cap-grid mt-14 grid grid-cols-1 border border-dashed border-edge min-[560px]:grid-cols-2 min-[900px]:grid-cols-3"
        >
          {CAPABILITIES.map((feature, i) => (
            <CapabilityCard key={feature.title} feature={feature} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}
