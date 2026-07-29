/**
 * Dashboard usage counters (dashboard v1 phase 2). Per-owner, per-day, per-tool
 * call counts. Display-only, not a billing ledger — the write is a fire-and-forget
 * UPSERT that swallows its own errors, so a counter hiccup can never fail a tool
 * call (same idiom as stampLastUsed). Reads power the dashboard `/usage` view.
 */
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { Database } from './client';
import { ownerUsageDaily } from './schema';

export interface UsagePoint {
  /** UTC day, 'YYYY-MM-DD'. */
  date: string;
  count: number;
}

/**
 * Increment today's counter for (owner, tool). No-op when ownerId is null/empty
 * (operator-issued keys with no dashboard account). Fire-and-forget: an undercount
 * on a transient DB failure is acceptable for a display-only counter.
 */
export async function recordUsage(
  db: Database,
  ownerId: string | null | undefined,
  tool: string,
): Promise<void> {
  if (!ownerId) return;
  try {
    await db
      .insert(ownerUsageDaily)
      .values({ ownerId, date: sql`CURRENT_DATE`, tool, count: 1 })
      .onConflictDoUpdate({
        target: [ownerUsageDaily.ownerId, ownerUsageDaily.date, ownerUsageDaily.tool],
        set: { count: sql`${ownerUsageDaily.count} + 1` },
      });
  } catch {
    // Display-only counter: never let a usage write break the request.
  }
}

/** Trailing-`days`-window daily totals (summed across tools), plus today's total. */
export async function getUsageSummary(
  db: Database,
  ownerId: string,
  days: number,
): Promise<{ today: number; series: UsagePoint[] }> {
  const rows = await db
    .select({
      date: ownerUsageDaily.date,
      count: sql<number>`sum(${ownerUsageDaily.count})::int`,
    })
    .from(ownerUsageDaily)
    .where(
      and(
        eq(ownerUsageDaily.ownerId, ownerId),
        gte(ownerUsageDaily.date, sql`CURRENT_DATE - ${days - 1}`),
      ),
    )
    .groupBy(ownerUsageDaily.date)
    .orderBy(ownerUsageDaily.date);

  const series: UsagePoint[] = rows.map((r) => ({ date: String(r.date), count: Number(r.count) }));
  const todayUtc = new Date().toISOString().slice(0, 10);
  const today = series.find((p) => p.date === todayUtc)?.count ?? 0;
  return { today, series };
}

/** Trailing-`days`-window totals grouped by tool, busiest first. */
export async function getUsageByTool(
  db: Database,
  ownerId: string,
  days: number,
): Promise<{ tool: string; count: number }[]> {
  const rows = await db
    .select({
      tool: ownerUsageDaily.tool,
      count: sql<number>`sum(${ownerUsageDaily.count})::int`,
    })
    .from(ownerUsageDaily)
    .where(
      and(
        eq(ownerUsageDaily.ownerId, ownerId),
        gte(ownerUsageDaily.date, sql`CURRENT_DATE - ${days - 1}`),
      ),
    )
    .groupBy(ownerUsageDaily.tool)
    .orderBy(desc(sql`sum(${ownerUsageDaily.count})`));

  return rows.map((r) => ({ tool: r.tool, count: Number(r.count) }));
}
