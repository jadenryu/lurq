import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DIAGRAMS } from "@/components/site/diagrams";
import { CopyCommandButton } from "@/components/site/copy-command-button";
import { PageFrame, PageSection, SectionHeading } from "@/components/site/page-frame";
import { SOLUTIONS, SOLUTION_BY_SLUG } from "@/content/solutions";
import { TOOL_BY_SLUG } from "@/content/tools";
import { INSTALL_COMMAND } from "@/content/copy";

/**
 * One template, four pages: problem, mechanism, tools, install.
 *
 * THE PROBLEM SECTION COMES FIRST AND IT IS TWO PARAGRAPHS OF PROSE. That is
 * unusual for this site, which mostly argues with artifacts, and it is
 * deliberate here: a use-case page is read by someone who has not yet agreed
 * that the problem is theirs. A diagram cannot make that argument. Once they
 * have agreed, everything below is structure again.
 *
 * NO TESTIMONIALS AND NO LOGOS. There are no customers to quote. The `evidence`
 * line at the foot of each page is the substitute and it has a rule: it must be
 * something a reader can check, which is why three of the four are numbers out
 * of the index and the fourth is a published research finding.
 */

export function generateStaticParams() {
  return SOLUTIONS.map((solution) => ({ slug: solution.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const solution = SOLUTION_BY_SLUG.get(slug);
  if (!solution) return {};
  return { title: `${solution.name} | lurq`, description: solution.blurb };
}

export default async function SolutionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const solution = SOLUTION_BY_SLUG.get(slug);
  if (!solution) notFound();

  const Figure = DIAGRAMS[solution.figure];

  return (
    <PageFrame
      eyebrow={`Solutions · ${solution.name}`}
      back={{ label: "All solutions", href: "/solutions" }}
      title={solution.title}
      lead={solution.lead}
    >
      <PageSection>
        <div className="grid grid-cols-1 gap-8 min-[900px]:grid-cols-12 min-[900px]:gap-12">
          <div className="min-[900px]:col-span-7">
            <SectionHeading>What actually goes wrong</SectionHeading>
            {solution.problem.map((paragraph, i) => (
              <p key={i} className="mt-4 max-w-[64ch] text-[14px] leading-[1.75] text-ink-2">
                {paragraph}
              </p>
            ))}
          </div>

          <div className="min-[900px]:col-span-5">
            <div className="relative h-[220px] overflow-hidden rounded-xl border border-edge border-t-edge-lit bg-surface">
              <Figure id={`solution-page-${solution.slug}`} fit="meet" />
            </div>
          </div>
        </div>
      </PageSection>

      <PageSection>
        <SectionHeading>What lurq does about it</SectionHeading>
        <ol className="mt-7 grid grid-cols-1 gap-x-8 gap-y-8 min-[900px]:grid-cols-3">
          {solution.steps.map((step, i) => (
            <li key={step.title} className="border-t border-edge pt-4">
              <span className="font-mono text-[11px] text-ink-3">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-2.5 text-[15px] font-medium leading-snug text-ink">{step.title}</h3>
              <p className="mt-2 text-[13.5px] leading-[1.65] text-ink-2">{step.body}</p>
            </li>
          ))}
        </ol>
      </PageSection>

      <PageSection>
        <SectionHeading>The calls behind it</SectionHeading>
        <div className="mt-6 grid grid-cols-1 gap-4 min-[720px]:grid-cols-3">
          {solution.tools.map((toolSlug) => {
            const tool = TOOL_BY_SLUG.get(toolSlug);
            if (!tool) return null;
            return (
              <Link
                key={toolSlug}
                href={`/product/${toolSlug}`}
                className="flex flex-col rounded-xl border border-edge border-t-edge-lit bg-surface p-5 transition-[border-color] duration-[--dur-hover] hover:border-edge-lit focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark"
              >
                <p className="font-mono text-[12px] text-ink">{tool.slug}</p>
                <p className="mt-2 flex-1 text-[13px] leading-[1.6] text-ink-2">{tool.question}</p>
                <p className="mt-4 font-mono text-[11px] text-ink-3">{tool.group}</p>
              </Link>
            );
          })}
        </div>

        {/* The checkable line. Not a quote, not a logo, not a percentage
            uplift: those are the three things a page like this normally ends
            on and all three would be invented. */}
        <p className="mt-8 max-w-[72ch] border-t border-edge pt-5 text-[13px] leading-[1.7] text-ink-2">
          {solution.evidence}
        </p>
      </PageSection>

      <PageSection>
        <div className="rounded-xl border border-edge border-t-edge-lit bg-surface px-6 py-8 min-[900px]:px-10 min-[900px]:py-10">
          <SectionHeading>One command, and it is in every assistant you have.</SectionHeading>
          <p className="mt-3 max-w-[58ch] text-[13.5px] leading-[1.65] text-ink-2">
            Setup works out which clients are installed and writes a keyed MCP entry and a skill
            file for each of them. The free plan never asks for a card.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <CopyCommandButton command={INSTALL_COMMAND} label={INSTALL_COMMAND} variant="solid" />
            <Link
              href="/solutions"
              className="inline-flex h-11 items-center rounded-md border border-edge px-5 text-[14px] text-ink-2 transition-[color,border-color] duration-[--dur-hover] hover:border-edge-lit hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark"
            >
              The other three cases
            </Link>
          </div>
        </div>
      </PageSection>
    </PageFrame>
  );
}
