/**
 * Reads and writes for `subscriptions`, plus the entitlement question the
 * request path actually asks: what is this account allowed to do right now.
 *
 * Two things write here: the Stripe webhook, and `grantPlan` for a plan sold
 * before a processor existed. Everything else reads.
 */
import { and, desc, eq, gte, like, sql } from 'drizzle-orm';
import { isServed, planFor, type Plan, type Tier } from '../core/plans';
import type { Database } from './client';
import { ownerUsageDaily, subscriptions, type SubscriptionRow } from './schema';

/**
 * Marks a row as hand-granted rather than Stripe-backed.
 *
 * `stripe_customer_id` is `not null unique`, and a manual grant has no Stripe
 * customer to put there. A synthetic id keyed on the owner satisfies both
 * constraints, cannot collide with a real `cus_...`, and makes every hand-issued
 * plan greppable in one `like` — which is what the expiry gate in
 * `entitlementFor` keys off.
 */
const MANUAL_PREFIX = 'manual:';

export const manualCustomerId = (ownerId: string) => `${MANUAL_PREFIX}${ownerId}`;

export function isManualGrant(sub: { stripeCustomerId: string }): boolean {
  return sub.stripeCustomerId.startsWith(MANUAL_PREFIX);
}

/** Past its end date. Only ever true of a manual grant; see `entitlementFor`. */
export function grantLapsed(sub: SubscriptionRow, now: Date): boolean {
  return (
    isManualGrant(sub) &&
    sub.currentPeriodEnd != null &&
    sub.currentPeriodEnd.getTime() <= now.getTime()
  );
}

export async function getSubscription(
  db: Database,
  ownerId: string,
): Promise<SubscriptionRow | null> {
  const rows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.ownerId, ownerId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getSubscriptionByCustomer(
  db: Database,
  stripeCustomerId: string,
): Promise<SubscriptionRow | null> {
  const rows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.stripeCustomerId, stripeCustomerId))
    .limit(1);
  return rows[0] ?? null;
}

/** Link an account to its Stripe customer, before any subscription exists. */
export async function linkCustomer(
  db: Database,
  ownerId: string,
  stripeCustomerId: string,
): Promise<void> {
  await db
    .insert(subscriptions)
    .values({ ownerId, stripeCustomerId })
    .onConflictDoUpdate({
      target: subscriptions.ownerId,
      set: { stripeCustomerId, updatedAt: new Date() },
    });
}

export interface SubscriptionUpdate {
  tier: Tier;
  status: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  eventAt: Date;
}

/**
 * Apply a webhook's view of a subscription.
 *
 * The `last_event_at` guard is the important part. Stripe does not promise
 * ordering and retries for up to three days, so a redelivered
 * `customer.subscription.updated` from before a cancellation can easily arrive
 * after it. Without the guard that resurrects a cancelled plan, and the customer
 * keeps being served something they stopped paying for until the next event
 * happens to correct it. Older events are dropped, not applied.
 */
export async function applySubscriptionEvent(
  db: Database,
  stripeCustomerId: string,
  update: SubscriptionUpdate,
): Promise<boolean> {
  const result = await db
    .insert(subscriptions)
    .values({
      // A webhook can legitimately arrive for a customer we have no row for
      // (created in the Stripe dashboard, or our insert lost a race with
      // checkout). ownerId comes from customer metadata in that case; the
      // caller resolves it and passes a row that already exists, so this
      // conflict target is the customer, not the owner.
      ownerId: sql`coalesce(
        (select s.owner_id from subscriptions s where s.stripe_customer_id = ${stripeCustomerId}),
        ${'stripe:' + stripeCustomerId}
      )`,
      stripeCustomerId,
      stripeSubscriptionId: update.stripeSubscriptionId,
      tier: update.tier,
      status: update.status,
      currentPeriodEnd: update.currentPeriodEnd,
      cancelAtPeriodEnd: update.cancelAtPeriodEnd,
      lastEventAt: update.eventAt,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: subscriptions.stripeCustomerId,
      set: {
        stripeSubscriptionId: update.stripeSubscriptionId,
        tier: update.tier,
        status: update.status,
        currentPeriodEnd: update.currentPeriodEnd,
        cancelAtPeriodEnd: update.cancelAtPeriodEnd,
        lastEventAt: update.eventAt,
        updatedAt: new Date(),
      },
      setWhere: sql`${subscriptions.lastEventAt} is null or ${subscriptions.lastEventAt} <= ${update.eventAt}`,
    })
    .returning({ ownerId: subscriptions.ownerId });
  return result.length > 0;
}

/**
 * Hand-grant a paid plan to an account, for money collected outside Stripe.
 *
 * `entitlementFor` reads tier and status and has no opinion about who collected,
 * so from the request path this is indistinguishable from a subscription.
 *
 * `months` is required and capped by the caller. A hand-granted plan has nobody
 * watching it: no webhook arrives when a card fails, when the customer cancels,
 * or when a month simply is not paid again. An open-ended grant is a free
 * account in perpetuity that nobody remembers creating, and it fails silently
 * and forever — so the end date is mandatory and enforced on read.
 *
 * Refuses to touch a Stripe-backed row. Overwriting a real subscription with a
 * manual one would orphan the Stripe customer: the webhook would keep arriving
 * for a `stripe_customer_id` no longer on the row, and the next event would
 * insert a duplicate account.
 *
 * ponytail: no `note` column, so the invoice number lives wherever you invoiced.
 * Add one (nullable text + migration) when "who is this and why" stops being
 * answerable from memory.
 */
export async function grantPlan(
  db: Database,
  opts: { ownerId: string; tier: Tier; months: number; now?: Date },
): Promise<{ granted: true; until: Date } | { granted: false; reason: string }> {
  const now = opts.now ?? new Date();
  const until = new Date(now);
  until.setMonth(until.getMonth() + opts.months);

  const existing = await getSubscription(db, opts.ownerId);
  if (existing && !isManualGrant(existing)) {
    return { granted: false, reason: 'account has a Stripe subscription; manage it in Stripe' };
  }

  await db
    .insert(subscriptions)
    .values({
      ownerId: opts.ownerId,
      stripeCustomerId: manualCustomerId(opts.ownerId),
      tier: opts.tier,
      status: 'active',
      currentPeriodEnd: until,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: subscriptions.ownerId,
      set: { tier: opts.tier, status: 'active', currentPeriodEnd: until, updatedAt: now },
    });

  return { granted: true, until };
}

/** End a hand-granted plan now. Stripe-backed rows are refused, not cancelled. */
export async function revokeGrant(
  db: Database,
  ownerId: string,
  now = new Date(),
): Promise<{ revoked: boolean; reason?: string }> {
  const existing = await getSubscription(db, ownerId);
  if (!existing) return { revoked: false, reason: 'no subscription for that account' };
  if (!isManualGrant(existing)) {
    return { revoked: false, reason: 'Stripe-backed; cancel it in Stripe, not here' };
  }

  await db
    .update(subscriptions)
    .set({ status: 'canceled', currentPeriodEnd: now, updatedAt: now })
    .where(eq(subscriptions.ownerId, ownerId));
  return { revoked: true };
}

/**
 * Every hand-granted plan, soonest to lapse first.
 *
 * Lapsed grants stay listed rather than disappearing, so the date is visible
 * when it passes and can be renewed or chased.
 */
export async function listGrants(db: Database): Promise<SubscriptionRow[]> {
  return db
    .select()
    .from(subscriptions)
    .where(like(subscriptions.stripeCustomerId, `${MANUAL_PREFIX}%`))
    .orderBy(subscriptions.currentPeriodEnd, desc(subscriptions.updatedAt));
}

/** Calls this account has made in the current calendar month, all tools. */
export async function monthlyCallCount(db: Database, ownerId: string): Promise<number> {
  const rows = await db
    .select({ total: sql<string>`coalesce(sum(${ownerUsageDaily.count}), 0)` })
    .from(ownerUsageDaily)
    .where(
      and(
        eq(ownerUsageDaily.ownerId, ownerId),
        gte(ownerUsageDaily.date, sql`date_trunc('month', CURRENT_DATE)::date`),
      ),
    );
  return Number(rows[0]?.total ?? 0);
}

export interface Entitlement {
  plan: Plan;
  /** Calls used this calendar month. */
  used: number;
  /** False once the monthly allowance is spent. Uncapped plans are always true. */
  withinQuota: boolean;
}

/**
 * What this account may do right now: the plan it is entitled to, and whether it
 * has spent the month's allowance.
 *
 * A subscription whose status Stripe no longer serves (`canceled`, `unpaid`,
 * `incomplete_expired`) falls back to Free rather than to nothing. Someone who
 * cancels keeps the free tier they would have had if they had never paid, which
 * is both the kinder behaviour and the one that does not break their CI on the
 * day their card expires.
 *
 * A hand-granted plan additionally lapses at its end date. Stripe-backed rows
 * are deliberately NOT gated this way: Stripe tells us when a subscription ends,
 * and gating on the date as well would drop a paying customer for the minutes
 * between a renewal and its webhook.
 */
export async function entitlementFor(
  db: Database,
  ownerId: string | null | undefined,
): Promise<Entitlement> {
  // Operator-issued keys have no dashboard account. They are ours, not a
  // customer's, and are not metered.
  if (!ownerId) {
    return { plan: planFor('enterprise'), used: 0, withinQuota: true };
  }

  const [sub, used] = await Promise.all([
    getSubscription(db, ownerId),
    monthlyCallCount(db, ownerId),
  ]);

  const served = sub != null && isServed(sub.status) && !grantLapsed(sub, new Date());
  const plan = planFor(served ? sub!.tier : 'free');
  const withinQuota = plan.monthlyCalls === null || used < plan.monthlyCalls;
  return { plan, used, withinQuota };
}
