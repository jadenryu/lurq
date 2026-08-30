"use client";

import Link from "next/link";
import { useAuth } from "@clerk/nextjs";

import { PLANS, PRICING_BODY, PRICING_HEAD, PRICING_NOTE, type Plan } from "@/content/pricing";
import { CONTACT_EMAIL } from "@/content/copy";
import { useRevealOnce } from "@/lib/use-reveal-once";

/**
 * Three plans on the room surface, after the reader has been shown how to
 * install the thing.
 *
 * Rebuilt rather than restored. The original (components/sections/section-pricing,
 * removed in ecba588) was built on the dashboard's shadcn controls: Container,
 * Reveal, buttonVariants, bg-card, border-border, --radius-lg. Dropping that onto
 * this ground reads as a different product, the same way contact-form.tsx did.
 * The data survives, the chrome does not.
 *
 * TWO CARDS CANNOT BE BOUGHT, AND SAY SO. There is no payment processor in the
 * repo and no tier enforcement behind the key, so a "Start Pro" button would be
 * a checkout that does not exist. Gated plans keep their price, which is the
 * part worth stating early, and trade the purchase for a waitlist or an email.
 * See the note at the top of content/pricing.ts before wiring billing.
 *
 * The tile is `.room-cap-card`, the same slab the capability grid uses. It is a
 * surface, an inset hairline and a hover step, none of which is specific to a
 * capability, and a second near-identical block of card CSS is how two sections
 * start drifting apart. Reveal is the page's own schedule, driven by
 * lib/use-reveal-once.
 */

/**
 * Bottom of the card. Only Free performs a transaction; the rest defer.
 *
 * Free routes the way the nav's CTA routes, to /sign-up rather than a Clerk
 * modal, and swaps to the dashboard once you are signed in for the reason the
 * nav gives: "Get started" offered to someone who already started is a dead end.
 * Two primary actions on one page that behave differently is worse than either
 * behaviour on its own.
 */
function PlanAction({ plan }: { plan: Plan }) {
  const base =
    "inline-flex w-full items-center justify-center rounded-md px-4 py-2.5 text-[13px] font-medium transition-[background-color,border-color,color] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark";
  const { isSignedIn } = useAuth();
  const filled = `${base} bg-ink text-ground hover:bg-white`;
  const outlined = `${base} border border-edge text-ink hover:border-ink`;

  if (plan.ctaType === "contact") {
    return (
      <a
        href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("lurq Enterprise")}`}
        className={outlined}
      >
        {plan.cta}
      </a>
    );
  }

  if (plan.ctaType === "waitlist") {
    // The waitlist is the contact section, which already has a working route,
    // Turnstile and rate limiting behind it. A second capture form for four
    // people a week is a form to maintain, an inbox to watch and a table to
    // migrate, and this is one anchor.
    return (
      <a href="#contact" className={outlined}>
        {plan.cta}
      </a>
    );
  }

  return (
    <Link href={isSignedIn ? "/dashboard" : "/sign-up"} className={filled}>
      {isSignedIn ? "Go to dashboard" : plan.cta}
    </Link>
  );
}

function PlanCard({ plan, index }: { plan: Plan; index: number }) {
  return (
    <article
      data-card
      style={{ ["--reveal-at" as string]: `${120 + index * 80}ms` }}
      className={[
        "room-cap-card relative isolate flex flex-col rounded-[10px] p-6 min-[720px]:p-7",
        // The featured plan is lifted by its ring rather than by a fill, so the
        // three cards stay the same object at three weights.
        plan.featured ? "shadow-[0_0_0_1px_var(--edge-lit)]" : "",
      ].join(" ")}
    >
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
          {plan.name}
        </h3>
        {plan.gated ? (
          <span className="rounded-[3px] border border-edge px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">
            Soon
          </span>
        ) : null}
      </header>

      <p className="mt-5 flex items-baseline gap-1">
        <span className="font-sans text-[34px] font-medium leading-none tracking-[-0.03em] text-ink">
          {plan.price}
        </span>
        <span className="text-[13px] text-ink-3">{plan.period}</span>
      </p>

      <p className="mt-3 text-[13px] leading-[1.6] text-ink-2">{plan.description}</p>

      {/* Hairline rows, the construction the FAQ and the contact channels use. */}
      <ul className="mt-6 flex-1 border-t border-edge">
        {plan.features.map((f) => (
          <li key={f} className="border-b border-edge py-2.5 text-[13px] leading-[1.5] text-ink-2">
            {f}
          </li>
        ))}
      </ul>

      <div className="mt-6">
        <PlanAction plan={plan} />
      </div>
    </article>
  );
}

export function Pricing() {
  const { ref, played } = useRevealOnce<HTMLDivElement>();

  return (
    <section id="pricing" className="w-full py-24 min-[900px]:py-32">
      <div className="mx-auto w-full max-w-[1180px] px-4 min-[768px]:px-6">
        <h2
          className="max-w-[20ch] font-sans font-medium text-ink"
          style={{
            fontSize: "clamp(1.75rem, 3.4vw, 2.5rem)",
            lineHeight: 1.1,
            letterSpacing: "-0.028em",
          }}
        >
          {PRICING_HEAD}
        </h2>
        <p className="mt-6 max-w-[52ch] text-[14px] leading-[1.6] text-ink-2">{PRICING_BODY}</p>

        <div
          ref={ref}
          data-playing={played ? "true" : "false"}
          className="room-price-grid mt-12 grid grid-cols-1 items-stretch gap-3 min-[720px]:grid-cols-3"
        >
          {PLANS.map((plan, i) => (
            <PlanCard key={plan.name} plan={plan} index={i} />
          ))}
        </div>

        <p className="mt-6 max-w-[68ch] text-[13px] leading-[1.6] text-ink-3">{PRICING_NOTE}</p>
      </div>
    </section>
  );
}
