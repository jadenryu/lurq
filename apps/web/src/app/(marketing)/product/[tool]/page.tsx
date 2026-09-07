import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DIAGRAMS } from "@/components/site/diagrams";
import { PageFrame, PageSection, SectionHeading } from "@/components/site/page-frame";
import { TOOL_BY_SLUG, TOOLS } from "@/content/tools";
import { DOCS_URL } from "@/lib/site-links";

/**
 * One template, ten pages.
 *
 * Every tool page is the same five blocks in the same order: what it answers,
 * how it works, what it takes, what comes back, and where to go next. That is
 * not laziness about layout, it is the point. Ten hand-shaped pages would let
 * each one argue in its own way, and a reader comparing two tools would be
 * comparing two essays instead of two schemas. The template makes them
 * comparable, which is the thing a reference surface is for.
 *
 * Prerendered at build time via generateStaticParams: the content is a
 * TypeScript constant, so there is nothing to render on demand and no reason to
 * pay for a lambda on a page that cannot change between deploys.
 */

export function generateStaticParams() {
  return TOOLS.map((tool) => ({ tool: tool.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tool: string }>;
}): Promise<Metadata> {
  const { tool: slug } = await params;
  const tool = TOOL_BY_SLUG.get(slug);
  if (!tool) return {};
  return {
    title: `${tool.slug} | lurq`,
    // The lead rather than a written-for-search summary. It is already one
    // paragraph and it is already the sentence that describes the tool, and a
    // second description is a second thing to keep true.
    description: tool.lead,
  };
}

export default async function ToolPage({ params }: { params: Promise<{ tool: string }> }) {
  const { tool: slug } = await params;
  const tool = TOOL_BY_SLUG.get(slug);
  if (!tool) notFound();

  const Figure = DIAGRAMS[tool.figure];

  return (
    <PageFrame
      eyebrow={`Product · ${tool.group}`}
      back={{ label: "All tools", href: "/product" }}
      title={tool.question}
      lead={tool.lead}
    >
      {/* The drawing, at panel size and fitted rather than cropped. On the home
          page the same figure is a bento tile's picture and is meant to be cut
          by the card; here it is the only illustration on the page. */}
      <PageSection>
        <div className="grid grid-cols-1 gap-5 min-[900px]:grid-cols-12">
          <div className="relative h-[240px] overflow-hidden rounded-xl border border-edge border-t-edge-lit bg-surface min-[900px]:col-span-7 min-[900px]:h-[320px]">
            <Figure id={`tool-${tool.slug}`} fit="meet" />
          </div>

          <div className="flex flex-col justify-center rounded-xl border border-edge bg-surface-2 p-6 min-[900px]:col-span-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.07em] text-ink-3">
              When to call it
            </p>
            <p className="mt-3 text-[14.5px] leading-[1.6] text-ink">{tool.whenToCall}</p>
            <p className="mt-5 border-t border-edge pt-4 font-mono text-[11.5px] leading-[1.55] text-ink-3">
              Registered as <span className="text-ink-2">{tool.slug}</span> on the MCP server.
            </p>
          </div>
        </div>
      </PageSection>

      <PageSection>
        <SectionHeading>How it works</SectionHeading>
        <ol className="mt-7 grid grid-cols-1 gap-x-8 gap-y-7 min-[900px]:grid-cols-3">
          {tool.mechanism.map((step, i) => (
            <li key={i} className="border-t border-edge pt-4">
              <span className="font-mono text-[11px] text-ink-3">
                {String(i + 1).padStart(2, "0")}
              </span>
              <p className="mt-2.5 text-[13.5px] leading-[1.65] text-ink-2">{step}</p>
            </li>
          ))}
        </ol>
      </PageSection>

      {/* Arguments and return fields as two tables, side by side above 1100px.
          A definition list rather than a <table>: these are name/description
          pairs with no second column of data, and a two-cell table row is a
          table pretending to have structure it does not have. */}
      <PageSection>
        <div className="grid grid-cols-1 gap-10 min-[1100px]:grid-cols-2 min-[1100px]:gap-14">
          <div>
            <SectionHeading className="!text-[17px]">Arguments</SectionHeading>
            <dl className="mt-5">
              {tool.args.map((arg) => (
                <div key={arg.name} className="border-t border-edge py-4">
                  <dt className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                    <span className="font-mono text-[13px] text-ink">{arg.name}</span>
                    <span className="font-mono text-[11.5px] text-ink-3">{arg.type}</span>
                    {!arg.required && (
                      <span className="rounded-full border border-edge px-1.5 py-px font-mono text-[10px] text-ink-3">
                        optional
                      </span>
                    )}
                  </dt>
                  <dd className="mt-1.5 max-w-[52ch] text-[13px] leading-[1.6] text-ink-2">
                    {arg.note}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div>
            <SectionHeading className="!text-[17px]">What comes back</SectionHeading>
            <dl className="mt-5">
              {tool.returns.map((field) => (
                <div key={field.name} className="border-t border-edge py-4">
                  <dt className="font-mono text-[13px] text-ink">{field.name}</dt>
                  <dd className="mt-1.5 max-w-[52ch] text-[13px] leading-[1.6] text-ink-2">
                    {field.note}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </PageSection>

      <PageSection>
        <SectionHeading>The call</SectionHeading>
        <div className="mt-6 grid grid-cols-1 gap-4 min-[900px]:grid-cols-2">
          <div className="overflow-hidden rounded-xl border border-edge border-t-edge-lit">
            <div className="room-code-bar">
              <span className="font-mono text-[11px] text-ink-2">{tool.slug}</span>
              <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3">
                request
              </span>
            </div>
            <pre className="room-code">{tool.call}</pre>
          </div>

          <div className="overflow-hidden rounded-xl border border-edge border-t-edge-lit">
            <div className="room-code-bar">
              <span className="font-mono text-[11px] text-ink-2">response</span>
              <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3">
                shape, not an answer
              </span>
            </div>
            <pre className="room-code">{tool.shape}</pre>
          </div>
        </div>

        {/* Said on the page rather than only in a source comment. A reader who
            assumes these are live figures and finds out later has been misled by
            omission, and this site's whole argument is about claims you can
            check. */}
        <p className="mt-4 max-w-[72ch] font-mono text-[11px] leading-[1.6] text-ink-3">
          The right-hand panel is the response schema. lurq does not print stored verdicts on this
          site: a score or a version here would be a claim about a day that has already passed. The
          one recorded run on the home page is generated from a real CLI invocation and fails the
          build if the CLI does.
        </p>
      </PageSection>

      <PageSection>
        <SectionHeading>Next</SectionHeading>
        <div className="mt-6 grid grid-cols-1 gap-4 min-[720px]:grid-cols-3">
          {tool.related.map((slug) => {
            const other = TOOL_BY_SLUG.get(slug);
            if (!other) return null;
            return (
              <Link
                key={slug}
                href={`/product/${other.slug}`}
                className="group rounded-xl border border-edge bg-surface p-5 transition-[border-color] duration-[--dur-hover] hover:border-edge-lit focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark"
              >
                <p className="font-mono text-[12px] text-ink">{other.slug}</p>
                <p className="mt-2 text-[13px] leading-[1.6] text-ink-2">{other.question}</p>
              </Link>
            );
          })}
          <a
            href={DOCS_URL}
            className="rounded-xl border border-edge bg-surface p-5 transition-[border-color] duration-[--dur-hover] hover:border-edge-lit focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark"
          >
            <p className="font-mono text-[12px] text-ink">
              docs
              <span aria-hidden className="pl-1 text-[10px] opacity-60">
                ↗
              </span>
            </p>
            <p className="mt-2 text-[13px] leading-[1.6] text-ink-2">
              Install it, and call this from your own client.
            </p>
          </a>
        </div>
      </PageSection>
    </PageFrame>
  );
}
