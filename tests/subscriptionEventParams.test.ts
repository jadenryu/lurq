import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { isNull, lte, or, sql } from 'drizzle-orm';
import { subscriptions } from '../src/db/schema';

/**
 * The webhook's entitlement write once threw on every event, and nothing
 * noticed: /billing/webhook 200s before doing the work, so Stripe recorded a
 * successful delivery, never retried, and every paying account silently stayed
 * on free. The cause was a Date interpolated into a raw sql`` template.
 *
 * Drizzle applies a column's type mapper only to values it can attribute to a
 * column. Inside sql`` it cannot, so the Date reached postgres.js unconverted
 * and the driver rejected it. These assert the parameter never goes out as a
 * Date — offline, via toSQL(); postgres.js opens no connection until a query
 * actually runs.
 */
const db = drizzle(postgres('postgres://user:pass@127.0.0.1:5432/unused'));
const WHEN = new Date('2026-09-04T22:37:36.000Z');

describe('subscription event guard parameters', () => {
  it('sends the timestamp as a string, not a Date', () => {
    const { params } = db
      .select()
      .from(subscriptions)
      .where(or(isNull(subscriptions.lastEventAt), lte(subscriptions.lastEventAt, WHEN)))
      .toSQL();

    expect(params.some((p) => p instanceof Date)).toBe(false);
    expect(params).toContain(WHEN.toISOString());
  });

  it('demonstrates the trap: a raw template leaks the Date through', () => {
    // Not how the code is written, and this is why. If a future Drizzle maps
    // dates inside sql`` too, this flips and the comment above can go.
    const { params } = db
      .select()
      .from(subscriptions)
      .where(sql`${subscriptions.lastEventAt} <= ${WHEN}`)
      .toSQL();

    expect(params.some((p) => p instanceof Date)).toBe(true);
  });
});
