/**
 * The durable half of the Ask budget.
 *
 * The route also keeps an in-memory hourly ledger, which is a burst guard: it
 * lives on one serverless instance and resets on cold start. This is the part
 * that actually holds a daily ceiling, because it is the only copy that
 * survives a restart and is shared by every instance.
 *
 * Everything here is awaited and every failure propagates. That is the whole
 * difference between this and `db/usage.ts` next door, whose writes are
 * fire-and-forget because an undercounted display figure is harmless — an
 * undercounted budget is a budget that has stopped working, and the caller has
 * to be able to tell the difference between "under the cap" and "could not
 * read the cap".
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from './client';
import { askSpendDaily } from './schema';

/** $1 as micro-dollars. Costs are integers here so a running total can't drift. */
export const MICROS_PER_USD = 1_000_000;

export function usdToMicros(usd: number): number {
  // Round rather than truncate: truncating every write biases the ledger low,
  // which over thousands of sub-cent calls quietly raises the real ceiling.
  return Math.max(0, Math.round(usd * MICROS_PER_USD));
}

/** What this account has spent on Ask today (UTC). Zero when it has no row. */
export async function getAskSpendToday(db: Database, ownerId: string): Promise<number> {
  const rows = await db
    .select({ usdMicros: askSpendDaily.usdMicros })
    .from(askSpendDaily)
    .where(and(eq(askSpendDaily.ownerId, ownerId), eq(askSpendDaily.date, sql`CURRENT_DATE`)))
    .limit(1);
  return rows[0]?.usdMicros ?? 0;
}

/**
 * Apply a signed delta to today's total and return the new value.
 *
 * Signed because the caller reserves before spending and settles after: a
 * question charges its worst case up front so a concurrent question cannot read
 * a total that ignores it, then refunds the difference once the real cost is
 * known. The refund is the negative case.
 *
 * The arithmetic happens in SQL, not by reading into the app and writing back.
 * Two questions answered concurrently on different instances would otherwise
 * both read the same total and the second would overwrite the first, losing a
 * charge every time the feature is actually busy — which is exactly when a
 * budget needs to be right.
 *
 * Clamped at zero on both paths. A refund larger than what is on the row is a
 * bug rather than an attack (this sits behind the issuer secret, so the caller
 * is our own server), but a negative balance would hand out budget that was
 * never spent, so the floor is enforced in the statement rather than trusted.
 */
export async function addAskSpend(
  db: Database,
  ownerId: string,
  micros: number,
): Promise<number> {
  if (micros === 0) return getAskSpendToday(db, ownerId);
  const rows = await db
    .insert(askSpendDaily)
    .values({ ownerId, date: sql`CURRENT_DATE`, usdMicros: Math.max(0, micros) })
    .onConflictDoUpdate({
      target: [askSpendDaily.ownerId, askSpendDaily.date],
      set: { usdMicros: sql`greatest(0, ${askSpendDaily.usdMicros} + ${micros})` },
    })
    .returning({ usdMicros: askSpendDaily.usdMicros });
  return rows[0]?.usdMicros ?? Math.max(0, micros);
}
