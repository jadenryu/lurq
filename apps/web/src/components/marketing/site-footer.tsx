import Link from "next/link";
import { Container } from "@/components/marketing/primitives";
import { ContactForm } from "@/components/common/contact-form";
import { MCP_ENDPOINT, NPM_URL, REPO_URL } from "@/lib/marketing-copy";
import { DOCS_URL } from "@/lib/site-links";
import { shortDate, stats } from "@/lib/marketing-data";

type FooterLink = { label: string; href: string };

const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: "product",
    links: [
      { label: "the graph", href: "/#stack" },
      { label: "what it does", href: "/#capabilities" },
      { label: "install", href: "/#install" },
      { label: "limits", href: "/#limits" },
    ],
  },
  {
    title: "developers",
    links: [
      { label: "docs", href: DOCS_URL },
      { label: "github", href: REPO_URL },
      { label: "npm", href: NPM_URL },
      { label: "mcp endpoint", href: MCP_ENDPOINT },
    ],
  },
  {
    title: "company",
    links: [
      { label: "about", href: "/about" },
      { label: "partnerships", href: "/partnerships" },
      { label: "faq", href: "/#faq" },
    ],
  },
  {
    title: "legal",
    links: [
      { label: "license", href: "/license" },
      { label: "privacy", href: "/privacy" },
      { label: "terms", href: "/terms" },
    ],
  },
];

/**
 * Four columns on the sunk paper, with the contact form folded in rather than
 * taking a section of its own. Everything here is paper: the page already has its
 * three dark moments (the graph, the install band, the closing line) and a fourth
 * would undo the alternation they exist to create.
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-rule bg-paper-2 py-14 md:py-24">
      <Container>
        <div className="grid gap-12 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
              {COLUMNS.map((col) => (
                <div key={col.title}>
                  <h3 className="t-label">{col.title}</h3>
                  <ul className="mt-4 space-y-2.5">
                    {col.links.map((l) => (
                      <li key={l.label}>
                        {l.href.startsWith("/") && !l.href.startsWith("/#") ? (
                          <Link
                            href={l.href}
                            className="font-mono text-[0.8125rem] text-ink-soft transition-colors duration-[120ms] hover:text-mark"
                          >
                            {l.label}
                          </Link>
                        ) : (
                          <a
                            href={l.href}
                            className="font-mono text-[0.8125rem] text-ink-soft transition-colors duration-[120ms] hover:text-mark"
                          >
                            {l.label}
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <div className="mt-12 max-w-[46ch]">
              <p className="font-mono text-[0.9375rem] text-ink">lurq</p>
              <p className="t-body mt-3 text-ink-soft">
                A dependency check your coding agent can call: what a version actually
                exports, whether a set of packages holds together, and whether a name is
                real. Read-only, timestamped, and open source.
              </p>
            </div>
          </div>

          <div id="contact" className="lg:col-span-5">
            <h3 className="t-h3 text-ink">Edge case, bug, or a question</h3>
            <p className="t-data mt-2 text-ink-soft">
              Goes to a person. If you found something on this page that is wrong, this
              is the fastest way to tell us.
            </p>
            <div className="mt-5">
              <ContactForm tone="paper" />
            </div>
          </div>
        </div>

        {/* The live status moved to the nav, where it gets seen. */}
        <div className="mt-12 border-t border-rule pt-8 font-mono text-[0.75rem] text-ink-soft">
          <span>
            index refreshed {shortDate(stats.dataAsOf)} · lurq v
            {stats.npm.latestVersion ?? "0.0.6"} · apache-2.0
          </span>
        </div>
      </Container>
    </footer>
  );
}
