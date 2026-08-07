import { ParticleGlobe } from "@/components/site/particle-globe";
import { GLOBE_TINTS, markFor, tintFor } from "@/components/site/source-marks";
import {
  PROVENANCE_BODY,
  PROVENANCE_HEAD,
  PROVENANCE_LABEL,
  PROVENANCE_STATS,
  RINGS,
  SOURCES,
} from "@/content/provenance";

/**
 * The ten upstream hosts as three orbits over the index.
 *
 * Adapted from a 21st.dev "orbiting circles" block, keeping its arrangement: a
 * particle sphere half-sunk into the bottom edge, rings anchored to the same
 * point so only their top arc is on screen, badged icons riding them. Two parts
 * of the reference could not come across and were rebuilt:
 *
 *   · the sphere was a WebGL import that never shipped with the snippet. See
 *     particle-globe.tsx for why canvas 2D does the same job at no weight.
 *   · the icons were nine hotlinks to another project's CDN. See
 *     source-marks.tsx for why they are drawn here, and where the colour
 *     comes from.
 *
 * A node spends part of its cycle below the fold line, which is the cost of this
 * composition and the reason the named list underneath is not optional: the ring
 * is the picture, the list is what makes it checkable. The headline promises "a
 * host you can check yourself", so every host is printed.
 */

/**
 * Ring diameters, inner out, with the period each one turns in.
 *
 * Written as classes rather than inline pixels because these need a breakpoint,
 * and an inline style cannot carry one. The rings are deliberately wider than
 * the viewport at both sizes: the container clips them, and that crop is what
 * makes the arcs read as the top of something much larger.
 */
const GEOMETRY = [
  { size: "w-[340px] h-[340px] min-[900px]:w-[560px] min-[900px]:h-[560px]", duration: 48 },
  { size: "w-[460px] h-[460px] min-[900px]:w-[740px] min-[900px]:h-[740px]", duration: 62 },
  { size: "w-[580px] h-[580px] min-[900px]:w-[920px] min-[900px]:h-[920px]", duration: 78 },
];

/**
 * Each badge is drawn twice, half a turn apart.
 *
 * This is the reference block's trick and it does two things at once. It doubles
 * how many badges are on an arc, so a ring is populated instead of being three
 * dots on a long empty curve. And because the rings are cut at their own centre
 * line, a pair can never both be on screen: whichever copy is above the horizon
 * has its twin below it, so one rises on the right exactly as the other sinks on
 * the left. Ten sources, ten badges visible, twenty seats.
 */
const COPIES = [0, 180];

function Orbit() {
  return (
    <div
      aria-hidden
      /* Must clear the outer ring's own radius (920/2 = 460 desktop, 580/2 = 290
         mobile) plus the badge that overhangs it, or the widest arc gets cut
         flat at the top and reads as two vertical lines rather than an orbit. */
      className="relative mt-16 h-[320px] w-full overflow-hidden min-[900px]:h-[500px]"
    >
      {/* Half-sunk, so the horizon line is the section's own bottom edge. Held
          clear of the inner ring: at 400px the sphere reaches r=200, and the
          inner badges swing in to 560/2 - 28 = 252. */}
      <div className="absolute bottom-0 left-1/2 aspect-square w-[220px] -translate-x-1/2 translate-y-1/2 min-[900px]:w-[400px]">
        <ParticleGlobe className="h-full w-full text-ink" tints={GLOBE_TINTS} />
      </div>

      {RINGS.map((nodes, ring) => {
        const { size, duration } = GEOMETRY[ring];
        return (
          <div
            key={ring}
            className={`absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 rounded-full border border-edge ${size}`}
          >
            {nodes.flatMap(({ source, angle: base }) =>
              COPIES.map((offset) => {
                const angle = base + offset;
                const Glyph = markFor(source.host);
                const tint = tintFor(source.host);
                return (
                  // The arm: zero-width, one radius long, pinned to the ring
                  // centre and rotated. Zero width is what centres a badge of
                  // any size on the ring without the reference's hardcoded
                  // -ml-8, which only ever centred its own 64px icon.
                  <div
                    key={`${source.host}-${offset}`}
                    className="room-orbit-arm absolute left-1/2 top-0 h-1/2 w-0 origin-bottom"
                    style={{
                      ["--start-angle" as string]: `${angle}deg`,
                      ["--orbit-dur" as string]: `${duration}s`,
                      // Alternating direction. One signed multiplier in the
                      // keyframes, rather than the reference's four
                      // near-identical cw/ccw animations.
                      ["--orbit-dir" as string]: ring % 2 === 0 ? 1 : -1,
                    }}
                  >
                    {/* The slot carries the static half-offset, so it never
                        shares a transform with the animated ones either side. */}
                    <div className="absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2">
                      <div className="room-orbit-chip">
                        <span
                          className="flex h-12 w-12 items-center justify-center rounded-full border bg-surface min-[900px]:h-14 min-[900px]:w-14"
                          style={{
                            color: tint,
                            // The rim picks up a trace of the same hue so the
                            // badge reads as tinted rather than as a grey ring
                            // with something coloured dropped inside it.
                            borderColor: `color-mix(in oklab, ${tint} 45%, var(--edge))`,
                          }}
                        >
                          <Glyph className="h-5 w-5 min-[900px]:h-6 min-[900px]:w-6" />
                        </span>
                      </div>
                    </div>
                  </div>
                );
              }),
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ProvenanceOrbit() {
  return (
    // py-24/py-32, the page rhythm. Was py-20/py-24.
    <section id="sources" className="w-full py-24 min-[900px]:py-32">
      <div className="mx-auto w-full max-w-[1180px] px-4 min-[768px]:px-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-3">
          {PROVENANCE_LABEL}
        </p>
        <h2
          className="mt-4 max-w-[24ch] font-sans font-medium text-ink"
          style={{
            fontSize: "clamp(1.6rem, 3vw, 2.25rem)",
            lineHeight: 1.12,
            letterSpacing: "-0.028em",
          }}
        >
          {PROVENANCE_HEAD}
        </h2>
        <p className="mt-4 max-w-[62ch] text-[13px] leading-[1.6] text-ink-2">{PROVENANCE_BODY}</p>
      </div>

      {/* Outside the padded container: the rings are meant to run past the text
          column and get cut by the viewport, not by a 1180px box. */}
      <Orbit />

      <div className="mx-auto w-full max-w-[1180px] px-4 min-[768px]:px-6">
        {/* The key to the ring above, and the receipts for the headline.
            One line per source, not the three-line card this started as: the
            `short` blurb duplicated the body paragraph, and ten small essays
            under a picture is the feature grid this section is not. */}
        <ul className="mt-14 grid grid-cols-1 gap-x-10 gap-y-3 min-[560px]:grid-cols-2 min-[900px]:grid-cols-3">
          {SOURCES.map((source) => {
            const Glyph = markFor(source.host);
            return (
              <li
                key={source.host}
                className="flex items-center gap-2.5 border-t border-edge py-2.5"
              >
                <Glyph className="h-4 w-4 shrink-0" style={{ color: tintFor(source.host) }} />
                <span className="shrink-0 font-sans text-[13px] text-ink">{source.name}</span>
                <span className="truncate font-mono text-[11px] text-ink-3">{source.host}</span>
              </li>
            );
          })}
        </ul>

        <dl className="mt-12 grid grid-cols-2 gap-6 border-t border-edge pt-6 min-[720px]:grid-cols-5">
          {PROVENANCE_STATS.map((stat) => (
            <div key={stat.label}>
              <dt className="sr-only">{stat.label}</dt>
              <dd>
                <span className="block font-sans text-[22px] font-medium tracking-[-0.02em] text-ink">
                  {stat.value}
                </span>
                <span className="mt-1 block font-mono text-[11px] text-ink-3">{stat.label}</span>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
