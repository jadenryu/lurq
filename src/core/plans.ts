/**
 * The plans: what they cost, what they include, and what they are allowed to
 * spend. ONE definition, imported by both sides.
 *
 * The pricing page reads this through the `@lurq/core/*` alias and the quota
 * enforcement in mcp/http.ts reads it directly, which is the entire point. The
 * previous pricing page carried its own copy of the numbers and opened with a
 * comment admitting they were placeholders that nothing enforced; a marketing
 * page and a 429 disagreeing about what you bought is the kind of bug you find
 * out about from a customer.
 *
 * `monthlyCalls: null` means uncapped. Free is deliberately usable without a
 * card: an index nobody can try is an index nobody adopts.
 *
 * Prices are in cents and exist here for display only. Stripe is the authority
 * on what anyone is actually charged, and the amount shown to a reader is not
 * the amount in the Price object unless someone keeps them in step, so treat a
 * change here as needing the matching change in the Stripe dashboard.
 */

export type Tier = 'free' | 'pro' | 'enterprise';

export const TIERS = ['free', 'pro', 'enterprise'] as const;

export interface Plan {
  tier: Tier;
  name: string;
  /** Display only. Stripe holds the real number. */
  priceCents: number;
  /** Hosted tool calls per calendar month. null = uncapped. */
  monthlyCalls: number | null;
  /** Per-minute burst ceiling, enforced by the express limiter. */
  ratePerMinute: number;
  /** One line under the price. Kept to a single clause. */
  tagline: string;
  /** Shown on the card. Lead with what changes from the tier below. */
  features: string[];
  /** Requires a Stripe subscription. Free never does. */
  paid: boolean;
  /** Priced on application rather than self-serve checkout. */
  contactOnly?: boolean;
}

export const PLANS: Record<Tier, Plan> = {
  free: {
    tier: 'free',
    name: 'Free',
    priceCents: 0,
    monthlyCalls: 200,
    ratePerMinute: 60,
    tagline: 'Enough to find out whether the index is telling the truth.',
    features: [
      'CLI and installable skill',
      '200 hosted calls a month',
      'recommend, evaluate, verify',
      'Daily refreshed index',
      'Community support',
    ],
    paid: false,
  },
  pro: {
    tier: 'pro',
    name: 'Pro',
    priceCents: 500,
    monthlyCalls: 10_000,
    ratePerMinute: 120,
    tagline: 'For one developer who runs it on every install.',
    features: [
      '10,000 hosted calls a month',
      'compare, diagram and plan',
      'Repo autopilot and drift alerts',
      'Priority index freshness',
      'Email support',
    ],
    paid: true,
  },
  enterprise: {
    tier: 'enterprise',
    name: 'Enterprise',
    priceCents: 10_000,
    monthlyCalls: null,
    ratePerMinute: 600,
    tagline: 'For a team that needs the graph under its own controls.',
    features: [
      'Uncapped hosted calls',
      'SSO and audit logs',
      'Private compatibility runs',
      'Custom SLA',
      'Dedicated support channel',
    ],
    paid: true,
    contactOnly: true,
  },
};

export const PLAN_LIST: Plan[] = TIERS.map((t) => PLANS[t]);

/** Unknown or malformed tier strings resolve to Free, never to unlimited. */
export function planFor(tier: string | null | undefined): Plan {
  return PLANS[(tier ?? 'free') as Tier] ?? PLANS.free;
}

/**
 * Whether a subscription in this Stripe status should still be served at its
 * paid tier.
 *
 * `past_due` deliberately counts. A card that failed at 03:00 is a dunning
 * problem, not a reason to start 429ing someone's CI mid-run; Stripe retries
 * for days and only then moves the subscription to `canceled`, which does not
 * count here. Cutting service on the first failed charge is how you turn an
 * expired card into a churned customer.
 */
export const SERVED_STATUSES = new Set(['active', 'trialing', 'past_due']);

export function isServed(status: string | null | undefined): boolean {
  return status != null && SERVED_STATUSES.has(status);
}
