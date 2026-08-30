/**
 * Reads and writes for `subscriptions`, plus the entitlement question the
 * request path actually asks: what is this account allowed to do right now.
 *
 * Only the Stripe webhook writes here. Everything else reads.
 */
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
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

export interface GrantOptions {
  tier: Tier;
  /** When the grant lapses. Required in practice — see the note below. */
  until: Date;
  /** Free-text, kept on the row so a later reader knows where the money came from. */
  note?: string | null;
}

/**
 * Grant a paid plan by hand, with no payment processor involved.
 *
 * This is how the first customers get served: they pay by invoice or through a
 * hosted checkout link somewhere else, and somebody runs this. It writes the
 * same two fields the Stripe webhook writes, because `entitlementFor` reads only
 * those two and does not care who paid.
 *
 * `until` is not optional by accident. A manual grant has nobody watching it:
 * no webhook arrives when a card fails, when the customer cancels, or when a
 * month simply is not paid again. An open-ended grant is therefore a free
 * account forever that nobody remembers creating, and the failure is silent and
 * permanent. Setting an end date makes the default outcome "lapses" rather than
 * "runs indefinitely"; re-granting is one command.
 *
 * `cancelAtPeriodEnd` is set because it is TRUE: a manual grant does not renew
 * itself. It also makes the dashboard say "Cancels on <date>, you keep
 * everything until then", which is exactly right and needed no new UI.
 */
export async function grantPlan(db: Database, ownerId: string, opts: GrantOptions): Promise<void> {
  const now = new Date();
  await db
    .insert(subscriptions)
    .values({
      ownerId,
      tier: opts.tier,
      status: 'active',
      currentPeriodEnd: opts.until,
      cancelAtPeriodEnd: true,
      manualNote: opts.note ?? null,
      lastEventAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: subscriptions.ownerId,
      set: {
        tier: opts.tier,
        status: 'active',
        currentPeriodEnd: opts.until,
        cancelAtPeriodEnd: true,
        manualNote: opts.note ?? null,
        lastEventAt: now,
        updatedAt: now,
      },
    });
}

/** End a manual grant now. Drops the account to free without deleting history. */
export async function revokePlan(db: Database, ownerId: string): Promise<boolean> {
  const rows = await db
    .update(subscriptions)
    .set({ tier: 'free', status: 'canceled', updatedAt: new Date() })
    .where(eq(subscriptions.ownerId, ownerId))
    .returning({ ownerId: subscriptions.ownerId });
  return rows.length > 0;
}

/** Every manual grant, for the operator to eyeball. Soonest to lapse first. */
export async function listGrants(db: Database): Promise<SubscriptionRow[]> {
  return db
    .select()
    .from(subscriptions)
    .where(isNull(subscriptions.stripeSubscriptionId))
    .orderBy(subscriptions.currentPeriodEnd);
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

/**
 * Whether a subscription row still buys anything.
 *
 * Stripe-backed rows trust `status` alone: Stripe tells us when a subscription
 * ends, and gating on `current_period_end` as well would drop a paying customer
 * to free for the minutes between a renewal and its webhook.
 *
 * A hand-granted row has no such narrator. Nothing will ever arrive to say the
 * customer stopped paying, so the end date is the only thing standing between a
 * favour and a free account in perpetuity, and it has to be enforced. Identified
 * by having no Stripe subscription attached.
 */
export function isEntitled(sub: SubscriptionRow, now: Date = new Date()): boolean {
  if (!isServed(sub.status)) return false;
  const manual = sub.stripeSubscriptionId === null;
  if (manual && sub.currentPeriodEnd && sub.currentPeriodEnd.getTime() <= now.getTime()) {
    return false;
  }
  return true;
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

  const plan = planFor(sub && isEntitled(sub) ? sub.tier : 'free');
  const withinQuota = plan.monthlyCalls === null || used < plan.monthlyCalls;
  return { plan, used, withinQuota };
}
