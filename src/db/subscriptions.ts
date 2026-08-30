/**
 * Reads and writes for `subscriptions`, plus the entitlement question the
 * request path actually asks: what is this account allowed to do right now.
 *
 * Only the Stripe webhook writes here. Everything else reads.
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import { isServed, planFor, type Plan, type Tier } from '../core/plans';
import type { Database } from './client';
import { ownerUsageDaily, subscriptions, type SubscriptionRow } from './schema';

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

  const plan = planFor(sub && isServed(sub.status) ? sub.tier : 'free');
  const withinQuota = plan.monthlyCalls === null || used < plan.monthlyCalls;
  return { plan, used, withinQuota };
}
