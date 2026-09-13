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
 * The ladder charges on who is buying, not on capability. The CLI and the core
 * tools stay whole for one person; money starts where lurq becomes a team's
 * control point (CI-enforced policy, a long decision log), which is where the
 * supply-chain incumbents draw the line too.
 *
 * Prices are in cents and exist here for display only. Stripe is the authority
 * on what anyone is actually charged, and the amount shown to a reader is not
 * the amount in the Price object unless someone keeps them in step, so treat a
 * change here as needing the matching change in the Stripe dashboard.
 *
 * The `enterprise` tier id is shown as "Business". The id is stored on
 * subscription rows and stamped into Stripe metadata, so renaming it would need
 * a backfill for a label change.
 */

export type Tier = 'free' | 'pro' | 'team' | 'enterprise';

export const TIERS = ['free', 'pro', 'team', 'enterprise'] as const;

export interface Plan {
  tier: Tier;
  name: string;
  /** Display only. Stripe holds the real number. Per seat when `perSeat`. */
  priceCents: number;
  /** The price is a floor ("from $1,000"), not the amount. */
  priceFrom?: boolean;
  /** Billed per seat; the Stripe subscription quantity is the seat count. */
  perSeat?: boolean;
  /** Fewest seats a per-seat plan sells. */
  minSeats?: number;
  /** Hosted tool calls per calendar month, per seat when `perSeat`. null = uncapped. */
  monthlyCalls: number | null;
  /** Per-minute burst ceiling, enforced by the express limiter. */
  ratePerMinute: number;
  /**
   * Dashboard Ask spend per UTC day, in dollars. Must be > 0: the web route
   * reads a zero limit as "no limit". Free is a taste, not a workload — each
   * question reserves $0.25 up front, so $0.30 is about three Sonnet questions.
   */
  askDailyUsd: number;
  /** How far back the policy decision log can be read. */
  decisionLogDays: number;
  /** May mint `policy:write` keys, the ones CI uses to push a reviewed policy. */
  ciPolicyKeys: boolean;
  /** One line under the price. Kept to a single clause. */
  tagline: string;
  /** Shown on the card. Lead with what changes from the tier below. */
  features: string[];
  /** Requires a Stripe subscription. Free never does. */
  paid: boolean;
  /** Priced on application rather than self-serve checkout. */
  contactOnly?: boolean;
}

/**
 * Calls a capped plan may still make each day once the month's allowance is
 * spent. An agent that meets a hard 402 mid-task stops calling lurq and is
 * rarely switched back on; a trickle keeps it working and keeps the upgrade
 * message in front of whoever reads the agent's output.
 */
export const GRACE_CALLS_PER_DAY = 20;

export const PLANS: Record<Tier, Plan> = {
  free: {
    tier: 'free',
    name: 'Free',
    priceCents: 0,
    monthlyCalls: 1_000,
    ratePerMinute: 60,
    askDailyUsd: 0.3,
    decisionLogDays: 7,
    ciPolicyKeys: false,
    tagline: 'Enough to find out whether the index is telling the truth.',
    features: [
      'CLI and installable skill',
      '1,000 hosted calls a month',
      'verify, evaluate, recommend, compat',
      'Personal policy, 7-day decision log',
      'Community support',
    ],
    paid: false,
  },
  pro: {
    tier: 'pro',
    name: 'Pro',
    priceCents: 1_500,
    monthlyCalls: 10_000,
    ratePerMinute: 120,
    askDailyUsd: 3,
    decisionLogDays: 90,
    ciPolicyKeys: false,
    tagline: 'For one developer who runs it on every install.',
    features: [
      '10,000 hosted calls a month',
      'compare, diagram, surface diffs',
      'Repo autopilot and drift alerts',
      '90-day decision log',
      'Email support',
    ],
    paid: true,
  },
  team: {
    tier: 'team',
    name: 'Team',
    priceCents: 2_500,
    perSeat: true,
    minSeats: 3,
    monthlyCalls: 15_000,
    ratePerMinute: 300,
    // Between Pro and Business. The Ask budget is per account, not per seat, so a
    // bigger team shares it; scale it by seat if Team accounts hit the ceiling.
    askDailyUsd: 8,
    decisionLogDays: 365,
    ciPolicyKeys: true,
    tagline: 'For a team whose agents answer to one policy.',
    features: [
      '15,000 calls per seat, pooled',
      'CI keys that push a reviewed policy',
      'Audit trail, warn mode, expiring exceptions',
      '1-year decision log',
      'Priority support',
    ],
    paid: true,
  },
  enterprise: {
    tier: 'enterprise',
    name: 'Business',
    priceCents: 100_000,
    priceFrom: true,
    monthlyCalls: null,
    ratePerMinute: 600,
    askDailyUsd: 15,
    decisionLogDays: 365,
    ciPolicyKeys: true,
    tagline: 'For a company that needs the graph under its own controls.',
    features: [
      'Uncapped hosted calls',
      'SSO and audit export',
      'Private registry and compatibility runs',
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

/** Seats a plan is billed for: at least its minimum, and 1 for flat plans. */
export function billedSeats(plan: Plan, seats: number | null | undefined): number {
  if (!plan.perSeat) return 1;
  return Math.max(plan.minSeats ?? 1, Math.floor(seats ?? 0));
}

/** The account's monthly call allowance, pooled across seats. null = uncapped. */
export function monthlyAllowance(plan: Plan, seats: number | null | undefined): number | null {
  return plan.monthlyCalls === null ? null : plan.monthlyCalls * billedSeats(plan, seats);
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
