import type { ReactNode } from "react";
import { PageFrame } from "@/components/site/page-frame";
import { cn } from "@/lib/utils";

/**
 * The five standalone content pages (/about, /partnerships, and the three legal
 * ones), now rendered in the dark room like everything else.
 *
 * WHAT THIS USED TO BE, AND WHY IT WAS THE SITE'S WORST SEAM. It had its own
 * chrome: a sticky header with a "← Back to home" link instead of the site nav,
 * a gradient-clipped h1, the ambient `bg-grid` backdrop with a glow behind it,
 * `Container`, `Reveal` (framer-motion), and components/sections/footer.tsx.
 * None of that is the room. So /about and /privacy were visibly a different
 * product from /, a visitor navigating between them watched the entire page
 * language change, and the person most likely to make that trip is the one
 * reading the legal pages before signing up.
 *
 * It is now a thin adapter over PageFrame. The signature is unchanged on
 * purpose: five pages call this with `eyebrow`, `title`, `lead` and `width` and
 * none of them had to be edited. That is the whole reason the fix is one file
 * rather than five.
 *
 * The nav comes back with it, which is the part that matters beyond looks.
 * These pages had no way to reach Docs, Product, Solutions or Pricing at all:
 * one link home, and the old footer.
 *
 * WHAT IS GONE. `Reveal` and its framer-motion wrapper: PageFrame's header uses
 * the page's own CSS reveal schedule, and the body content of a legal page has
 * no business fading in. `Container`, `Logo` and sections/footer.tsx are all
 * still used elsewhere (auth-shell, the dashboard sidebar) and are untouched.
 */
export function PageShell({
  eyebrow,
  title,
  lead,
  /**
   * The content column. Prose wants a measure, not the 1180px the marketing
   * sections use, so this stays a narrow/wide switch rather than inheriting
   * PageSection's full width.
   */
  width = "narrow",
  children,
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
  width?: "narrow" | "wide";
  children: ReactNode;
}) {
  return (
    <PageFrame
      // PageFrame requires one, and every caller passes one except /privacy,
      // which is a legal page and belongs under the same label as the other two.
      eyebrow={eyebrow ?? "Legal"}
      title={title}
      lead={lead}
      back={{ label: "Home", href: "/" }}
    >
      <section className="w-full px-4 pb-20 min-[768px]:px-6 min-[900px]:pb-24">
        <div
          className={cn(
            "mx-auto w-full",
            width === "wide" ? "max-w-[880px]" : "max-w-[720px]",
          )}
        >
          {children}
        </div>
      </section>
    </PageFrame>
  );
}
