import type { ReactNode } from "react";
import Link from "next/link";
import { SiteNav } from "@/components/site/nav";
import { SiteFooter } from "@/components/site/footer";
import { GradientBlob } from "@/components/site/gradient-blob";

/**
 * The shell every page under (marketing) that is not the home page.
 *
 * WHY THIS EXISTS AND components/common/page-shell.tsx DOES NOT DIE YET. There
 * were two shells on this site and they belonged to two different design
 * systems. PageShell renders the older one: shadcn's `text-muted-foreground` and
 * `border-border`, a gradient-clipped h1, the `bg-grid` backdrop, and
 * components/sections/footer.tsx. The home page renders the dark room. So
 * /about and /privacy were visibly a different product from /, and the seam
 * showed on every navigation between them.
 *
 * This is the room's version. New pages use it. PageShell is migrated onto the
 * same tokens in a later commit rather than in this one, so a regression in the
 * migration cannot take the new pages down with it.
 *
 * THE HEADER IS TYPE ON A BLOOM, LIKE THE HERO, AND NOTHING ELSE. No eyebrow
 * chip, no ambient grid, no glow parked in a corner. The hero established that
 * the page opens with a headline over weather and the weather sits UNDER the
 * type; a shell that opens differently is a second front door.
 */
export function PageFrame({
  /** Mono, uppercase, above the title. The section this page belongs to. */
  eyebrow,
  title,
  lead,
  /** Rendered to the right of the eyebrow as "← Back to X". */
  back,
  children,
}: {
  eyebrow: string;
  title: string;
  lead?: string;
  back?: { label: string; href: string };
  children: ReactNode;
}) {
  return (
    <>
      <SiteNav />
      <main id="content" tabIndex={-1} className="flex-1">
        {/* overflow-hidden because the blob is deliberately wider than the
            viewport and would otherwise scroll the page sideways. Same reason
            the footer carries it. */}
        <section className="relative w-full overflow-hidden pb-14 pt-[clamp(56px,8vh,104px)] min-[900px]:pb-20">
          <GradientBlob
            outer="inset-x-0 -top-64 min-h-[900px]"
            inner="left-[calc(50%-16rem)] min-h-[900px] rotate-[24deg] sm:left-[calc(50%-32rem)]"
          />

          <div className="relative z-10 mx-auto w-full max-w-[1180px] px-4 min-[768px]:px-6">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
              <p
                data-reveal
                style={{ ["--reveal-at" as string]: "120ms" }}
                className="font-mono text-[11px] uppercase tracking-[0.07em] text-ink-3"
              >
                {eyebrow}
              </p>
              {back && (
                <Link
                  href={back.href}
                  data-reveal
                  style={{ ["--reveal-at" as string]: "120ms" }}
                  className="text-[12.5px] text-ink-3 transition-[color] duration-(--dur-hover) hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark"
                >
                  <span aria-hidden className="pr-1">
                    ←
                  </span>
                  {back.label}
                </Link>
              )}
            </div>

            <h1
              data-reveal
              style={{
                ["--reveal-at" as string]: "220ms",
                fontSize: "clamp(2rem, 4.2vw, 3rem)",
                lineHeight: 1.08,
                letterSpacing: "-0.03em",
              }}
              className="mt-4 max-w-[20ch] font-sans font-medium text-ink"
            >
              {title}
            </h1>

            {lead && (
              <p
                data-reveal
                style={{
                  ["--reveal-at" as string]: "340ms",
                  fontSize: "clamp(14.5px, 1.4vw, 16px)",
                }}
                className="mt-5 max-w-[64ch] leading-[1.65] text-ink-2"
              >
                {lead}
              </p>
            )}
          </div>
        </section>

        {children}
      </main>
      <SiteFooter />
    </>
  );
}

/**
 * A section on a sub-page, at the home page's own rhythm.
 *
 * py-16/py-20 rather than the home page's py-24/py-32. A sub-page has a header
 * band above it and usually three or four sections under that, and at the home
 * page's spacing the whole thing reads as four landing pages stacked. The
 * container and the padding are identical, which is the part that has to match.
 */
export function PageSection({
  id,
  children,
  className = "",
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`w-full px-4 py-16 min-[768px]:px-6 min-[900px]:py-20 ${className}`}>
      <div className="mx-auto w-full max-w-[1180px]">{children}</div>
    </section>
  );
}

/** The h2 every section on this site uses. One place, so the clamp cannot drift. */
export function SectionHeading({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <h2
      className={`max-w-[26ch] font-sans font-medium text-ink ${className}`}
      style={{
        fontSize: "clamp(1.4rem, 2.6vw, 1.9rem)",
        lineHeight: 1.14,
        letterSpacing: "-0.026em",
      }}
    >
      {children}
    </h2>
  );
}
