import Link from "next/link";
import { PageShell } from "@/components/common/page-shell";
import { NotFoundVerdict } from "@/components/site/not-found-verdict";

/** Where to go instead. /docs is a separate zone (apps/docs), so it takes a plain <a>. */
const REAL_PAGES = [
  { label: "Home", href: "/" },
  { label: "Quickstart", href: "/docs/quickstart" },
  { label: "Docs", href: "/docs" },
  { label: "Pricing", href: "/#pricing" },
  { label: "Security", href: "/security" },
  { label: "Contact us", href: "/#contact" },
];

const LINK = "text-ink underline decoration-edge-lit underline-offset-4 hover:decoration-ink-3";

/**
 * The root not-found: every unmatched URL and every `notFound()` lands here, in
 * the same room (nav, header, footer) as the rest of the site, and answers the
 * bad address the way lurq answers a bad package name.
 */
export default function NotFound() {
  return (
    <PageShell eyebrow="404" title="Not a real page" lead="The link may be old, or the address mistyped.">
      <NotFoundVerdict />
      <h2 className="mt-10 font-mono text-[11px] uppercase tracking-[0.07em] text-ink-3">
        Pages that do exist
      </h2>
      <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-3 text-[14px]">
        {REAL_PAGES.map(({ label, href }) => (
          <li key={href}>
            {href.startsWith("/docs") ? (
              <a href={href} className={LINK}>
                {label}
              </a>
            ) : (
              <Link href={href} className={LINK}>
                {label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
