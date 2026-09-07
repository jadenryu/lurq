import Link from "next/link";
import { Wordmark } from "@/components/site/wordmark";
import { CopyCommandButton } from "@/components/site/copy-command-button";
import { GradientBlob } from "@/components/site/gradient-blob";
import {
  CLOSING_LINE_1,
  CLOSING_LINE_2,
  CLOSING_SUB,
  INSTALL_COMMAND,
  FOOTER_BLURB,
  FOOTER_RIGHTS,
} from "@/content/copy";
import { REPO_URL } from "@/lib/marketing-copy";
import { DOCS_URL } from "@/lib/site-links";

/**
 * The closing line, then the columns, on flat ground, no decorated field.
 *
 * Every link here goes somewhere that exists. There is no Careers page, no Blog,
 * no Customers, and inventing them to fill a column is how a footer starts
 * lying about the size of the thing behind it.
 *
 * WRITTEN OUT RATHER THAN DERIVED FROM content/nav.ts. The mega menu carries
 * twenty destinations with a blurb each; a footer carries a short label and
 * wants the four or five per column that a reader scans. Deriving one from the
 * other means either a footer with nine Product links or a nav data file
 * carrying `showInFooter` flags, and both are worse than two lists that a person
 * keeps in step. The rule for keeping them in step is the one above: a link here
 * has to resolve.
 *
 * The Solutions column is new and is the reason this was edited. Those pages had
 * existed for a pass before anything below the fold pointed at them.
 */
const COLUMNS = [
  {
    heading: "Product",
    links: [
      { label: "All tools", href: "/product" },
      { label: "Verify", href: "/product/verify" },
      { label: "Compat", href: "/product/compat" },
      { label: "Diff surface", href: "/product/diff_surface" },
      { label: "Pricing", href: "/#pricing" },
    ],
  },
  {
    heading: "Solutions",
    links: [
      { label: "Agent-assisted coding", href: "/solutions/agent-coding" },
      { label: "Upgrades and migrations", href: "/solutions/upgrades" },
      { label: "Pre-merge gating", href: "/solutions/ci" },
      { label: "Supply-chain defence", href: "/solutions/supply-chain" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { label: "Docs", href: DOCS_URL },
      { label: "Changelog", href: "/changelog" },
      { label: "Evidence", href: "/proof" },
      { label: "Dashboard", href: "/dashboard" },
      { label: "npm", href: "https://www.npmjs.com/package/lurqrun", external: true },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Partnerships", href: "/partnerships" },
      { label: "Book a demo", href: "/book-demo" },
      { label: "GitHub", href: REPO_URL, external: true },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
      { label: "License", href: "/license" },
    ],
  },
] as const;

const linkClass =
  "text-[13px] text-ink-2 transition-[color] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark";

export function SiteFooter() {
  return (
    // The bloom is the hero's, at the hero's strength, so the page closes in the
    // register it opened in. overflow-hidden because the blob is deliberately
    // wider than the viewport and would otherwise scroll the page sideways.
    <footer className="relative w-full overflow-hidden border-t border-edge">
      {/* Behind the closing line, not in a corner. The hero's blooms sit under
          its headline, and a glow parked away from the type reads as a
          rendering artefact rather than as the same device. */}
      <GradientBlob outer="inset-0" inner="left-1/2 top-[-8rem] rotate-[15deg] sm:top-[-12rem]" />

      <div className="relative z-10 mx-auto w-full max-w-[1180px] px-4 pb-10 pt-20 min-[768px]:px-6 min-[900px]:pt-24">
        <div className="pb-16 text-center min-[900px]:pb-20">
          <h2
            className="mx-auto max-w-[20ch] font-sans font-medium text-ink"
            style={{
              fontSize: "clamp(1.75rem, 3.6vw, 2.5rem)",
              lineHeight: 1.1,
              letterSpacing: "-0.03em",
            }}
          >
            <span className="block">{CLOSING_LINE_1}</span>
            <span className="block">{CLOSING_LINE_2}</span>
          </h2>
          <p className="mx-auto mt-4 max-w-[52ch] text-[14px] leading-[1.6] text-ink-2">
            {CLOSING_SUB}
          </p>
          {/* The command, not a second "Get started". The nav already carries
              that label, and two buttons with the same words on one page is a
              reader wondering which one is the real one. Ending on the thing you
              would actually type is a stronger close than a repeat. */}
          <div className="mt-7 flex justify-center">
            <CopyCommandButton command={INSTALL_COMMAND} label={INSTALL_COMMAND} variant="solid" />
          </div>
        </div>

        <div className="border-t border-edge pt-12">
          <div className="flex flex-col gap-12 min-[720px]:flex-row min-[720px]:gap-16">
            <div className="min-[720px]:max-w-[280px]">
              <Wordmark size={20} />
              <p className="mt-4 text-[13px] leading-[1.6] text-ink-2">{FOOTER_BLURB}</p>
            </div>

            <div className="grid flex-1 grid-cols-2 gap-x-8 gap-y-10 min-[560px]:grid-cols-3 min-[1024px]:grid-cols-5">
              {COLUMNS.map((col) => (
                <div key={col.heading}>
                  <h2 className="text-[11px] font-medium tracking-[0.04em] text-ink-3">
                    {col.heading}
                  </h2>
                  <ul className="mt-4 flex flex-col gap-2.5">
                    {col.links.map((l) => (
                      <li key={l.label}>
                        {"external" in l && l.external ? (
                          <a
                            href={l.href}
                            target="_blank"
                            rel="noopener"
                            className={linkClass}
                            style={{ transitionDuration: "var(--dur-hover)" }}
                          >
                            {l.label}
                            <span aria-hidden className="pl-1 text-[10px] opacity-60">
                              ↗
                            </span>
                          </a>
                        ) : (
                          <Link
                            href={l.href}
                            className={linkClass}
                            style={{ transitionDuration: "var(--dur-hover)" }}
                          >
                            {l.label}
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-12 border-t border-edge pt-5">
            <p className="font-mono text-[11px] text-ink-3">{FOOTER_RIGHTS}</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
