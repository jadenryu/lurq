import type { Metadata } from "next";
import Link from "next/link";
import { PageFrame, PageSection, SectionHeading } from "@/components/site/page-frame";
import { PRODUCT_HEAD, PRODUCT_LEAD, TOOL_GROUPS } from "@/content/tools";
import { SURFACES } from "@/content/surfaces";
import { DOCS_URL } from "@/lib/site-links";

export const metadata: Metadata = {
  title: "Product | lurq",
  description:
    "The ten tools lurq registers on its MCP server, with the schema each one accepts and the shape of what comes back.",
};

/**
 * Every tool, grouped by the kind of question it answers.
 *
 * WHY THE GROUPS AND NOT AN ALPHABETICAL LIST. Ten tools with no grouping is a
 * reference page, and a reference page already exists at /docs. The four groups
 * are the reading order of a real session: check the package is worth having,
 * check it fits, check the API is what you think it is, and tell us how it went.
 * Someone who reads only the group headings has still learned the shape of the
 * product.
 *
 * No figures on this page. Each card is a name, a question and a sentence, and
 * the drawing lives on the tool's own page where it has the room to be read.
 * Ten 480x340 figures on one index is a texture, not ten diagrams.
 */
export default function ProductIndex() {
  return (
    <PageFrame eyebrow="Product" title={PRODUCT_HEAD} lead={PRODUCT_LEAD}>
      {TOOL_GROUPS.map(([group, tools]) => (
        <PageSection key={group}>
          <div className="flex items-baseline justify-between gap-4 border-b border-edge pb-3">
            <SectionHeading className="!text-[17px] !tracking-[-0.01em]">{group}</SectionHeading>
            <span className="shrink-0 font-mono text-[11px] text-ink-3">
              {tools.length} {tools.length === 1 ? "tool" : "tools"}
            </span>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-x-6 gap-y-6 min-[720px]:grid-cols-2 min-[1100px]:grid-cols-3">
            {tools.map((tool) => (
              <Link
                key={tool.slug}
                href={`/product/${tool.slug}`}
                className="group flex flex-col rounded-xl border border-edge border-t-edge-lit bg-surface p-5 transition-[border-color,background-color] duration-(--dur-hover) hover:border-edge-lit hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark"
              >
                <p className="font-mono text-[12px] text-ink">{tool.slug}</p>
                <h3 className="mt-2.5 text-[15px] font-medium leading-snug text-ink">
                  {tool.question}
                </h3>
                <p className="mt-2 flex-1 text-[13px] leading-[1.6] text-ink-2">{tool.lead}</p>
                <span className="mt-4 text-[12.5px] text-mark opacity-0 transition-opacity duration-(--dur-hover) group-hover:opacity-100">
                  Read the schema
                  <span aria-hidden className="pl-1">
                    →
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </PageSection>
      ))}

      {/* How the tools are reached. The four surfaces are already written down
          in content/surfaces.ts for the home page's install section; this is the
          index-page-sized version of the same list, and the anchor the nav's
          "MCP server" row points at. */}
      <PageSection id="mcp">
        <SectionHeading>Four ways to reach the same ten tools.</SectionHeading>
        <p className="mt-4 max-w-[62ch] text-[13px] leading-[1.6] text-ink-2">
          The tools are registered once, on one server. The command line, the installable skill,
          a keyed MCP entry in your editor and the HTTP endpoint are four doors into it, and none
          of them sees a different index.
        </p>

        <ul className="mt-8 grid grid-cols-1 gap-x-8 gap-y-4 min-[720px]:grid-cols-2">
          {SURFACES.map((surface) => (
            <li key={surface.id} className="border-t border-edge pt-4">
              <p className="text-[14px] font-medium text-ink">{surface.name}</p>
              <p className="mt-1.5 text-[13px] leading-[1.6] text-ink-2">{surface.blurb}</p>
              <p className="mt-2 font-mono text-[11.5px] text-ink-3">{surface.command}</p>
            </li>
          ))}
        </ul>

        <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
          <Link
            href="/#use"
            className="inline-flex h-10 items-center rounded-md bg-ink px-4 text-[13.5px] font-medium text-ground transition-[background-color] duration-(--dur-hover) hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark"
          >
            See the setup
          </Link>
          <a
            href={DOCS_URL}
            className="text-[13px] text-ink-2 transition-[color] duration-(--dur-hover) hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark"
          >
            Full reference in the docs
            <span aria-hidden className="pl-1">
              →
            </span>
          </a>
        </div>
      </PageSection>
    </PageFrame>
  );
}
