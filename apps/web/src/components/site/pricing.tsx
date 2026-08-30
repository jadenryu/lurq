"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";

import {
  PRICING_BODY,
  PRICING_EYEBROW,
  PRICING_FEATURED_LABEL,
  PRICING_HEAD,
  PRICING_INHERITS,
  PRICING_NOTE,
} from "@/content/pricing";
import { CONTACT_EMAIL } from "@/content/copy";
import { useRevealOnce } from "@/lib/use-reveal-once";
import { PLAN_LIST, type Plan } from "@lurq/core/plans";

/**
 * Three plans on the room surface, after the reader has been shown how to
 * install the thing.
 *
 * THE NUMBERS ARE THE ENFORCED ONES. Every figure on these cards is read from
 * core/plans.ts, which is the same table mcp/http.ts meters against. The
 * previous version of this section kept its own copy and opened by admitting
 * they were placeholders; a page and a 402 disagreeing about what someone
 * bought is a bug you hear about from a customer rather than from a test.
 *
 * Rebuilt rather than restored. The original (removed in ecba588) was shadcn on
 * the dashboard's tokens, and this route has since been rebuilt on the room
 * surface, so restoring it would have read as a different product on the page.
 * The tile is `.room-cap-card`, unchanged, because a surface with an inset
 * hairline and a hover step is not specific to a capability and a second
 * near-identical block of card CSS is how two sections drift apart.
 *
 * Middle card only is emphasised, by ring rather than by fill, so the three
 * stay one object at three weights instead of becoming two designs.
 */

/** How the price reads. Whole dollars, because every plan is whole dollars. */
function priceLabel(plan: Plan): string {
  return plan.priceCents === 0 ? "$0" : `$${Math.round(plan.priceCents / 100)}`;
}

/** The allowance line, pulled out of the feature list into its own row. */
function allowanceLabel(plan: Plan): string {
  return plan.monthlyCalls === null
    ? "Uncapped hosted calls"
    : `${plan.monthlyCalls.toLocaleString("en-US")} hosted calls a month`;
}

const BTN =
  "inline-flex w-full items-center justify-center rounded-md px-4 py-2.5 text-[13px] font-medium transition-[background-color,border-color,color,opacity] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark disabled:cursor-not-allowed disabled:opacity-60";
const BTN_FILLED = `${BTN} bg-ink text-ground hover:bg-white`;
const BTN_OUTLINE = `${BTN} border border-edge text-ink hover:border-ink`;

/**
 * The buy button.
 *
 * Checkout is a POST that returns a Stripe URL rather than a link: the session
 * is created per click and its URL is single-use, so it cannot be baked into an
 * href at render time. Failure is shown in place instead of thrown, because the
 * one thing worse than a checkout that will not open is one that silently does
 * nothing when clicked.
 */
function BuyButton({ plan }: { plan: Plan }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { isSignedIn } = useAuth();

  // Signed out, checkout would bounce off a 401. Send them to sign up first and
  // come back, rather than opening Stripe for an account that does not exist.
  if (!isSignedIn) {
    return (
      <Link href={`/sign-up?next=${encodeURIComponent("/#pricing")}`} className={BTN_FILLED}>
        {`Start ${plan.name}`}
      </Link>
    );
  }

  const buy = async () => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: plan.tier }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      setError(data.error ?? "Could not start checkout.");
    } catch {
      setError("Could not reach the billing service.");
    }
    setPending(false);
  };

  return (
    <>
      <button type="button" onClick={buy} disabled={pending} className={BTN_FILLED}>
        {pending ? "Opening checkout…" : `Start ${plan.name}`}
      </button>
      {error ? (
        <p role="alert" className="mt-2 text-[12px] leading-[1.5] text-conflict">
          {error}{" "}
          <a href="#contact" className="underline underline-offset-2">
            Get in touch
          </a>
          .
        </p>
      ) : null}
    </>
  );
}

function PlanAction({ plan }: { plan: Plan }) {
  const { isSignedIn } = useAuth();

  if (plan.contactOnly) {
    return (
      <a
        href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("lurq Enterprise")}`}
        className={BTN_OUTLINE}
      >
        Talk to us
      </a>
    );
  }

  if (plan.paid) return <BuyButton plan={plan} />;

  // Free routes the way the nav's CTA routes, and swaps to the dashboard when
  // signed in for the reason the nav gives: offering "Get started" to someone
  // who already started is a dead end.
  return (
    <Link href={isSignedIn ? "/dashboard" : "/sign-up"} className={BTN_OUTLINE}>
      {isSignedIn ? "Go to dashboard" : "Get started"}
    </Link>
  );
}

function PlanCard({ plan, index, previous }: { plan: Plan; index: number; previous?: Plan }) {
  const featured = plan.tier === "pro";

  return (
    <article
      data-card
      style={{ ["--reveal-at" as string]: `${120 + index * 80}ms` }}
      className={[
        "room-cap-card relative isolate flex flex-col rounded-[10px] p-6 min-[720px]:p-7",
        featured ? "shadow-[0_0_0_1px_var(--edge-lit)]" : "",
      ].join(" ")}
    >
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
          {plan.name}
        </h3>
        {featured ? (
          <span className="rounded-[3px] border border-edge px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-2">
            {PRICING_FEATURED_LABEL}
          </span>
        ) : null}
      </header>

      <p className="mt-5 flex items-baseline gap-1">
        <span className="font-sans text-[34px] font-medium leading-none tracking-[-0.03em] text-ink">
          {priceLabel(plan)}
        </span>
        <span className="text-[13px] text-ink-3">/mo</span>
      </p>

      {/* The allowance gets its own line above the fold of the card: it is the
          number people are comparing, and burying it third in a bullet list
          makes three cards look identical at a glance. */}
      <p className="mt-4 border-t border-edge pt-4 text-[13px] font-medium text-ink">
        {allowanceLabel(plan)}
      </p>
      <p className="mt-2 text-[13px] leading-[1.6] text-ink-2">{plan.tagline}</p>

      <div className="mt-6 flex-1">
        {previous ? (
          <p className="mb-3 text-[12px] text-ink-3">{PRICING_INHERITS(previous.name)}</p>
        ) : null}
        <ul className="space-y-2.5">
          {plan.features
            // The allowance already has its own row above; repeating it as a
            // bullet is the card arguing with itself.
            .filter((f) => !/hosted calls/i.test(f))
            .map((f) => (
              <li key={f} className="flex gap-2.5 text-[13px] leading-[1.5] text-ink-2">
                <span aria-hidden className="mt-[1px] shrink-0 text-ink-3">
                  ✓
                </span>
                <span>{f}</span>
              </li>
            ))}
        </ul>
      </div>

      <div className="mt-7">
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
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-3">
          {PRICING_EYEBROW}
        </p>
        <h2
          className="mt-4 max-w-[20ch] font-sans font-medium text-ink"
          style={{
            fontSize: "clamp(1.75rem, 3.4vw, 2.5rem)",
            lineHeight: 1.1,
            letterSpacing: "-0.028em",
          }}
        >
          {PRICING_HEAD}
        </h2>
        <p className="mt-6 max-w-[58ch] text-[14px] leading-[1.6] text-ink-2">{PRICING_BODY}</p>

        <div
          ref={ref}
          data-playing={played ? "true" : "false"}
          className="room-price-grid mt-12 grid grid-cols-1 items-stretch gap-3 min-[720px]:grid-cols-3"
        >
          {PLAN_LIST.map((plan, i) => (
            <PlanCard key={plan.tier} plan={plan} index={i} previous={PLAN_LIST[i - 1]} />
          ))}
        </div>

        <p className="mt-8 max-w-[76ch] text-[13px] leading-[1.6] text-ink-3">{PRICING_NOTE}</p>
      </div>
    </section>
  );
}
