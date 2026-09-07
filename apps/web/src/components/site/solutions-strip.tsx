import Link from "next/link";
import { DIAGRAMS } from "@/components/site/diagrams";
import { SOLUTIONS, SOLUTIONS_HEAD, SOLUTIONS_LEAD } from "@/content/solutions";

/**
 * The four use cases, as four doors.
 *
 * A server component on purpose: four links and four static drawings need no
 * client bundle, and the reveal here is the page's plain `data-reveal`, which is
 * CSS. Every other new section on this page is "use client" for a reason it
 * could name (an observer, a tab list); this one could not name one.
 *
 * THE CARDS ARE NOT THE CAPABILITY GRID. That section is a bento of five tiles
 * that are mostly picture with the words on a plate over them. These are four
 * equal columns, picture on top, words below, hairline rules between: a
 * different arrangement of the same materials, so the page does not read as the
 * same card component used twice with different text.
 *
 * The figure is reused rather than drawn per solution, and two of the four share
 * one. That is deliberate: agent-coding and supply-chain are the same check at
 * two different stakes, and giving them different pictures would have implied
 * two different mechanisms.
 */
export function SolutionsStrip() {
  return (
    <section id="solutions" className="w-full px-4 py-24 min-[768px]:px-6 min-[900px]:py-32">
      <div className="mx-auto w-full max-w-[1180px]">
        <h2
          className="max-w-[24ch] font-sans font-medium text-ink"
          style={{
            fontSize: "clamp(1.6rem, 3vw, 2.25rem)",
            lineHeight: 1.12,
            letterSpacing: "-0.028em",
          }}
        >
          {SOLUTIONS_HEAD}
        </h2>
        <p className="mt-4 max-w-[62ch] text-[13px] leading-[1.6] text-ink-2">{SOLUTIONS_LEAD}</p>

        <div className="mt-10 grid grid-cols-1 gap-x-6 gap-y-10 min-[560px]:grid-cols-2 min-[1100px]:grid-cols-4">
          {SOLUTIONS.map((solution, i) => {
            const Figure = DIAGRAMS[solution.figure];
            return (
              <Link
                key={solution.slug}
                href={`/solutions/${solution.slug}`}
                data-reveal="panel"
                style={{ ["--reveal-at" as string]: `${100 + i * 90}ms` }}
                className="group block focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-mark"
              >
                {/* The figure is cropped here, not fitted: these tiles are 3:2
                    and the drawings are 4:3, and letterboxing four of them in a
                    row puts eight grey bars across the section. */}
                <div className="relative h-[132px] overflow-hidden rounded-lg border border-edge bg-surface transition-[border-color] duration-(--dur-hover) group-hover:border-edge-lit">
                  <Figure id={`solution-${solution.slug}`} />
                </div>

                <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.07em] text-ink-3">
                  {String(i + 1).padStart(2, "0")}
                </p>
                <h3 className="mt-2 text-[15px] font-medium leading-snug text-ink">
                  {solution.name}
                </h3>
                <p className="mt-2 text-[13px] leading-[1.6] text-ink-2">{solution.blurb}</p>
                <span className="mt-3 inline-block text-[12.5px] text-mark opacity-0 transition-opacity duration-(--dur-hover) group-hover:opacity-100">
                  Read it
                  <span aria-hidden className="pl-1">
                    →
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
