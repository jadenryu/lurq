/**
 * Metered overage: calls past a Team pool, sent to Stripe as meter events.
 *
 * The request path never talks to Stripe. It serves overage calls (see
 * `quotaState`) and counts them in `owner_usage_daily` like any other call; this
 * runs hourly and reports the difference between what the month has used past
 * the pool and what was already reported.
 *
 * Reporting a running delta rather than per-call events keeps Stripe traffic to
 * one event per account per hour, and the cumulative total in `identifier` makes
 * a retry after a crash (event sent, row not yet updated) a no-op on Stripe's
 * side, which dedupes identifiers for at least 24 hours.
 *
 * ponytail: the pool is per calendar month and Stripe bills per subscription
 * period, so overage lands on whichever invoice is open when it is reported.
 * Align the pool to the Stripe period if a customer ever needs the two to match.
 */
import { eq } from 'drizzle-orm';
import { isServed, monthlyAllowance, overageCalls, planFor } from '../core/plans';
import type { Database } from '../db/client';
import { subscriptions } from '../db/schema';
import { callsInMonth, isManualGrant } from '../db/subscriptions';
import { stripeClient } from './stripe';

/** The meter's event name. Provisioning creates the meter under this name. */
export const OVERAGE_EVENT = 'lurq_overage_calls';

export async function reportOverage(db: Database, now = new Date()): Promise<string[]> {
  const stripe = await stripeClient();
  if (!stripe) return ['billing disabled: STRIPE_SECRET_KEY is not set'];

  const month = now.toISOString().slice(0, 7);
  const rows = await db.select().from(subscriptions).where(eq(subscriptions.overageEnabled, true));
  const out: string[] = [];

  for (const sub of rows) {
    // A hand-granted plan has no Stripe customer to bill.
    if (!isServed(sub.status) || isManualGrant(sub)) continue;
    const limit = monthlyAllowance(planFor(sub.tier), sub.seats);

    // Close out the previous month before starting this one, so the last hour
    // of a month is billed rather than lost when the counter resets.
    const months =
      sub.overageMonth && sub.overageMonth !== month ? [sub.overageMonth, month] : [month];

    for (const m of months) {
      const reported = m === sub.overageMonth ? sub.overageReported : 0;
      const total = overageCalls(limit, await callsInMonth(db, sub.ownerId, m));
      const delta = total - reported;
      if (delta > 0) {
        await stripe.billing.meterEvents.create({
          event_name: OVERAGE_EVENT,
          payload: { stripe_customer_id: sub.stripeCustomerId, value: String(delta) },
          identifier: `${sub.ownerId}:${m}:${total}`,
        });
        out.push(`${sub.ownerId} ${m}: +${delta} overage calls (month total ${total})`);
      }
      await db
        .update(subscriptions)
        .set({ overageMonth: m, overageReported: Math.max(total, reported) })
        .where(eq(subscriptions.ownerId, sub.ownerId));
    }
  }

  return out.length > 0 ? out : ['no new overage to report'];
}
