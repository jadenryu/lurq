import type { Metadata } from "next";
import Link from "next/link";
import { DIAGRAMS } from "@/components/site/diagrams";
import { PageFrame, PageSection } from "@/components/site/page-frame";
import { SOLUTIONS, SOLUTIONS_HEAD, SOLUTIONS_LEAD } from "@/content/solutions";
import { TOOL_BY_SLUG } from "@/content/tools";

export const metadata: Metadata = {
  title: "Solutions | lurq",
  description:
    "Four places the same dependency check pays for itself: agent-assisted coding, upgrades, pre-merge gating, and supply-chain defence.",
};

/**
 * The four use cases, at full width, one row each.
 *
 * A row rather than a card grid. The home page already has the grid version of
 * this section and repeating it here would make the index a larger copy of a
 * strip the reader has just scrolled past. A row has space for the tools each
 * solution uses, which is the part that makes the page worth landing on: it
 * turns "here are four use cases" into "here are four use cases and the exact
 * calls behind them".
 */
export default function SolutionsIndex() {
  return (
    <PageFrame eyebrow="Solutions" title={SOLUTIONS_HEAD} lead={SOLUTIONS_LEAD}>
      <PageSection>
        <div className="flex flex-col">
          {SOLUTIONS.map((solution, i) => {
            const Figure = DIAGRAMS[solution.figure];
            return (
              <article
                key={solution.slug}
                className="grid grid-cols-1 gap-6 border-t border-edge py-8 min-[900px]:grid-cols-12 min-[900px]:gap-10 min-[900px]:py-10"
              >
                <div className="min-[900px]:col-span-4">
                  <div className="relative h-[150px] overflow-hidden rounded-lg border border-edge bg-surface">
                    <Figure id={`solutions-index-${solution.slug}`} />
                  </div>
                </div>

                <div className="min-[900px]:col-span-8">
                  <p className="font-mono text-[11px] text-ink-3">
                    {String(i + 1).padStart(2, "0")}
                  </p>
                  <h2 className="mt-2 max-w-[22ch] text-[19px] font-medium leading-snug tracking-[-0.015em] text-ink min-[900px]:text-[22px]">
                    {solution.name}
                  </h2>
                  <p className="mt-3 max-w-[62ch] text-[13.5px] leading-[1.65] text-ink-2">
                    {solution.blurb} {solution.lead}
                  </p>

                  {/* Every tool named here has a page, because the list is
                      slugs from content/tools.ts rather than prose. A
                      capability that stops being registered breaks this link
                      loudly instead of quietly staying in the copy. */}
                  <div className="mt-5 flex flex-wrap items-center gap-2">
                    {solution.tools.map((slug) => {
                      const tool = TOOL_BY_SLUG.get(slug);
                      if (!tool) return null;
                      return (
                        <Link
                          key={slug}
                          href={`/product/${slug}`}
                          className="rounded-full border border-edge px-2.5 py-1 font-mono text-[11.5px] text-ink-2 transition-[border-color,color] duration-[--dur-hover] hover:border-edge-lit hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark"
                        >
                          {slug}
                        </Link>
                      );
                    })}
                  </div>

                  <Link
                    href={`/solutions/${solution.slug}`}
                    className="mt-6 inline-block text-[13px] text-mark transition-[opacity] duration-[--dur-hover] hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark"
                  >
                    Read the whole case
                    <span aria-hidden className="pl-1">
                      →
                    </span>
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      </PageSection>
    </PageFrame>
  );
}
