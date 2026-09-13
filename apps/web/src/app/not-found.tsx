import Link from "next/link";
import { PageShell } from "@/components/common/page-shell";

/**
 * The root not-found: every unmatched URL and every `notFound()` lands here, in
 * the same room (nav, header, footer) as the rest of the site rather than on
 * Next's bare default.
 */
export default function NotFound() {
  return (
    <PageShell eyebrow="404" title="This page is not here">
      <p className="text-[15px] leading-[1.7] text-ink-2">
        The link may be old, or the address mistyped.
      </p>
      <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-[14px]">
        <Link href="/" className="text-ink underline decoration-edge-lit underline-offset-4 hover:decoration-ink-3">
          Back to home
        </Link>
        <a href="/docs" className="text-ink underline decoration-edge-lit underline-offset-4 hover:decoration-ink-3">
          Read the docs
        </a>
        <Link href="/#contact" className="text-ink underline decoration-edge-lit underline-offset-4 hover:decoration-ink-3">
          Contact us
        </Link>
      </div>
    </PageShell>
  );
}
