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
 * Add to today's total and return the new value.
 *
 * The increment happens in SQL (`usd_micros + excluded`), not by reading into
 * the app and writing back: two questions answered concurrently on different
 * instances would otherwise both read the same total and the second would
 * overwrite the first, losing a charge every time the feature is actually busy.
 */
export async function addAskSpend(
  db: Database,
  ownerId: string,
  micros: number,
): Promise<number> {
  if (micros <= 0) return getAskSpendToday(db, ownerId);
  const rows = await db
    .insert(askSpendDaily)
    .values({ ownerId, date: sql`CURRENT_DATE`, usdMicros: micros })
    .onConflictDoUpdate({
      target: [askSpendDaily.ownerId, askSpendDaily.date],
      set: { usdMicros: sql`${askSpendDaily.usdMicros} + ${micros}` },
    })
    .returning({ usdMicros: askSpendDaily.usdMicros });
  return rows[0]?.usdMicros ?? micros;
}
