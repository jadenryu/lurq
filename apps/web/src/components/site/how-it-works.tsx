"use client";

import {
  HOW_BODY,
  HOW_HEAD,
  INDEX_BODY,
  INDEX_FIGURES,
  INDEX_LABEL,
  STAGES,
} from "@/content/how";
import { useRevealOnce } from "@/lib/use-reveal-once";

/**
 * Where lurq physically sits, as three moments in time.
 *
 * The page had no answer to this. It demonstrated a run, argued the problem,
 * listed the surface and named the sources, and a reader could still finish it
 * believing this was a linter that runs after an install. See content/how.ts for
 * why that omission was the expensive one.
 *
 * THE WIRES ARE DECORATION AND THE PANELS ARE THE CONTENT. Every claim is in the
 * HTML above the drawing; the SVG underneath carries a line and a travelling
 * dash and nothing else, which is why it is aria-hidden with no title. A diagram
 * that is the only place something is stated is a diagram a screen reader user
 * is locked out of.
 *
 * The dash reuses .room-wire-pulse from the MCP-wires block in tokens.css, which
 * has been sitting there unused since the section it was drawn for was deleted.
 * Same technique, and the reason it is worth reusing rather than rewriting: one
 * property animates, the dash travels, and nothing in the DOM moves.
 */

/**
 * The wire layer, in the grid's own coordinate space.
 *
 * viewBox units are percentages of the container times ten, and
 * preserveAspectRatio is off, so the drawing stretches with the grid instead of
 * keeping a ratio the panels above it do not have. `vector-effect` on the
 * strokes (see tokens.css) is what keeps a 1px line 1px through that stretch,
 * and it is the only reason this trick is legal.
 */
function Wires({ delay }: { delay: number }) {
  return (
    <svg
      aria-hidden
      className="room-wires pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 1000 300"
      preserveAspectRatio="none"
      fill="none"
    >
      {/* The spine: straight through all three stages, entering and leaving the
          frame, because the flow it draws starts and ends off this page. */}
      <path className="room-wire" d="M0 90 H1000" />
      <path className="room-wire-pulse" d="M0 90 H1000" style={{ ["--pulse-at" as string]: `${delay}ms` }} />

      {/* The drop to the index, and the return. Two curves rather than one
          two-way arrow: the request and the answer are separate legs, and
          drawing them apart is what makes the round trip visible. */}
      <path className="room-wire" d="M470 90 C470 190, 430 190, 430 268" />
      <path className="room-wire" d="M530 268 C530 190, 570 190, 570 90" />
      <path
        className="room-wire-pulse"
        d="M470 90 C470 190, 430 190, 430 268"
        style={{ ["--pulse-at" as string]: `${delay + 500}ms` }}
      />
      <path
        className="room-wire-pulse"
        d="M530 268 C530 190, 570 190, 570 90"
        style={{ ["--pulse-at" as string]: `${delay + 1100}ms` }}
      />
    </svg>
  );
}

export function HowItWorks() {
  const { ref, played } = useRevealOnce<HTMLDivElement>();

  return (
    <section id="how" className="w-full px-4 py-24 min-[768px]:px-6 min-[900px]:py-32">
      <div className="mx-auto w-full max-w-[1180px]">
        <h2
          className="max-w-[24ch] font-sans font-medium text-ink"
          style={{
            fontSize: "clamp(1.6rem, 3vw, 2.25rem)",
            lineHeight: 1.12,
            letterSpacing: "-0.028em",
          }}
        >
          {HOW_HEAD}
        </h2>
        <p className="mt-4 max-w-[62ch] text-[13px] leading-[1.6] text-ink-2">{HOW_BODY}</p>

        <div
          ref={ref}
          data-playing={played ? "true" : undefined}
          className="room-flow mt-10"
        >
          {/* Only drawn from 900px up. Below that the stages are stacked, so a
              horizontal spine would run behind three panels in a column and
              connect nothing to anything. */}
          <div className="pointer-events-none absolute inset-0 hidden min-[900px]:block">
            <Wires delay={0} />
          </div>

          <div className="grid grid-cols-1 gap-4 min-[900px]:grid-cols-3 min-[900px]:gap-5">
            {STAGES.map((stage, i) => (
              <article
                key={stage.index}
                data-primary={i === 1 ? "true" : undefined}
                data-card
                style={{ ["--reveal-at" as string]: `${120 + i * 110}ms` }}
                className="room-flow-stage"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-[11px] uppercase tracking-[0.07em] text-ink-3">
                    {stage.label}
                  </span>
                  <span className="font-mono text-[11px] text-ink-3">{stage.index}</span>
                </div>
                <h3 className="mt-3 text-[16px] font-medium leading-snug text-ink">{stage.title}</h3>
                <p className="mt-2.5 flex-1 text-[13px] leading-[1.6] text-ink-2">{stage.body}</p>
                <p className="mt-5 border-t border-edge pt-3 font-mono text-[11px] leading-[1.5] text-ink-3">
                  {stage.foot}
                </p>
              </article>
            ))}
          </div>

          {/* The plinth. Sits under the return leg's landing point, so the two
              curves above it read as going somewhere rather than as decoration
              that happens to bend. */}
          <div
            data-card
            style={{ ["--reveal-at" as string]: "460ms" }}
            className="room-flow-plinth mt-5 px-5 py-5 min-[900px]:mt-8 min-[900px]:px-7 min-[900px]:py-6"
          >
            <div className="flex flex-col gap-4 min-[900px]:flex-row min-[900px]:items-center min-[900px]:justify-between min-[900px]:gap-10">
              <div className="min-[900px]:max-w-[34ch]">
                <p className="font-mono text-[11px] uppercase tracking-[0.07em] text-ink-3">
                  {INDEX_LABEL}
                </p>
                <p className="mt-2 text-[13px] leading-[1.6] text-ink-2">{INDEX_BODY}</p>
              </div>

              <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-5 min-[560px]:grid-cols-3 min-[1100px]:grid-cols-5">
                {INDEX_FIGURES.map((figure) => (
                  <div key={figure.label}>
                    <dt className="sr-only">{figure.label}</dt>
                    <dd>
                      <span className="block font-sans text-[19px] font-medium tracking-[-0.02em] text-ink">
                        {figure.value}
                      </span>
                      <span className="mt-1 block text-[11px] leading-[1.4] text-ink-3">
                        {figure.label}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
