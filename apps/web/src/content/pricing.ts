/**
 * The three plans, their prices, and what each one is allowed to claim.
 *
 * WHAT IS REAL TODAY, AND WHAT IS NOT. The prices are settled. The per-month
 * call quotas are not enforced anywhere: `src/mcp/http.ts` rate-limits every key
 * identically (LURQ_RATE_LIMIT_MAX, 120 a minute) and `api_keys.tier` is written
 * as 'free' and read by nothing. There is also no payment processor in the repo.
 *
 * So the paid cards do not pretend to sell. `gated: true` swaps the card's
 * action for a waitlist or a conversation, which is the honest shape of a plan
 * you cannot yet be charged for, and it is why `ctaType` has no 'checkout'.
 * When billing lands: enforce the quotas, branch on `api_keys.tier`, then drop
 * `gated` and point the CTA at the real flow. Until then the quotas below are
 * targets, and the card footnote says so in the reader's own words.
 *
 * House rules from content/copy.ts apply here too: sentence case, no em dashes,
 * and the word this page spends in the hero does not get spent again.
 */

export type PlanCta = "signup" | "waitlist" | "contact";

export interface Plan {
  name: string;
  price: string;
  period: string;
  /** One line under the price. */
  description: string;
  features: string[];
  cta: string;
  ctaType: PlanCta;
  /** Draws the emphasis ring and the flag. Exactly one plan may set it. */
  featured?: boolean;
  /** No way to pay for this yet. Renders the "soon" flag and a non-buying CTA. */
  gated?: boolean;
}

export const PRICING_HEAD = "Start on the CLI. Pay when it earns it.";

export const PRICING_BODY =
  "The command line and the installable skill are free and stay free. The hosted index is what the paid plans buy, and it is the part that costs us money to keep current.";

/**
 * Renders under the cards. This is the sentence that keeps the quotas above from
 * being a promise: they describe where the plans are going, and today every key
 * is rate limited the same way.
 */
export const PRICING_NOTE =
  "Paid plans are not open yet. Monthly call limits are the targets we are building to, not a meter running against your key today.";

export const PLANS: Plan[] = [
  {
    name: "Free",
    price: "$0",
    period: "/mo",
    description: "The CLI, and a taste of the hosted index.",
    features: [
      "CLI and installable skill",
      "Up to 200 hosted calls / month",
      "recommend, evaluate, verify",
      "Daily refreshed index",
      "Community support",
    ],
    cta: "Get started",
    ctaType: "signup",
  },
  {
    name: "Pro",
    price: "$5",
    period: "/mo",
    description: "For developers who live in their editor.",
    features: [
      "Everything in Free",
      "10,000 hosted calls / month",
      "compare and diagram tools",
      "Priority freshness",
      "Email support",
    ],
    cta: "Join the waitlist",
    ctaType: "waitlist",
    featured: true,
    gated: true,
  },
  {
    name: "Enterprise",
    price: "$100",
    period: "/mo",
    description: "For teams that need scale and controls.",
    features: [
      "Everything in Pro",
      "Unlimited hosted calls",
      "SSO and audit logs",
      "Custom SLA",
      "Dedicated support",
    ],
    cta: "Contact sales",
    ctaType: "contact",
    gated: true,
  },
];
