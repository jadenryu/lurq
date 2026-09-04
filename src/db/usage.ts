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
 * First day of a trailing `days`-day window, inclusive of today.
 *
 * The `::int` cast is load-bearing, not decoration. postgres.js's `inferType`
 * returns 0 (unspecified) for a plain JS number, so an uncast `CURRENT_DATE - $n`
 * lets Postgres resolve the operator as `date - date -> integer`; the surrounding
 * comparison then becomes `date >= integer` and the query dies with
 * `operator does not exist`. Shared by both readers so the cast can't drift.
 */
export function windowStart(days: number) {
  return sql`CURRENT_DATE - (${days}::int - 1)`;
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

/**
 * Trailing-`days`-window daily totals (summed across tools), plus today's total.
 *
 * The window is generated DB-side with `generate_series` and LEFT JOINed, so the
 * result is **gap-free**: every day in the window is present, zero-count days
 * included. Callers can therefore plot it on a uniform time axis — a series that
 * only carried days-with-traffic would render equal-width bars for unequal time
 * spans and misstate the trend.
 */
export async function getUsageSummary(
  db: Database,
  ownerId: string,
  days: number,
): Promise<{ today: number; series: UsagePoint[] }> {
  const rows = (await db.execute<{ date: string; count: number }>(sql`
    select
      to_char(d, 'YYYY-MM-DD') as date,
      coalesce(sum(u.count), 0)::int as count
    from generate_series(${windowStart(days)}, CURRENT_DATE, interval '1 day') as d
    left join ${ownerUsageDaily} u
      on u.date = d::date and u.owner_id = ${ownerId}
    group by d
    order by d
  `)) as unknown as { date: string; count: number }[];

  const series: UsagePoint[] = rows.map((r) => ({ date: String(r.date), count: Number(r.count) }));
  // The series ends at the database's CURRENT_DATE, which is the same clock the
  // counters are written against. Deriving "today" from the process's UTC date
  // instead would read 0 on any server not running in UTC.
  const today = series.at(-1)?.count ?? 0;
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
        gte(ownerUsageDaily.date, windowStart(days)),
      ),
    )
    .groupBy(ownerUsageDaily.tool)
    .orderBy(desc(sql`sum(${ownerUsageDaily.count})`));

  return rows.map((r) => ({ tool: r.tool, count: Number(r.count) }));
}

export interface UsageRetentionReport {
  /** Rows older than the cutoff. */
  stale: number;
  /** Rows kept. */
  retained: number;
  /** Oldest date still present, ISO 'YYYY-MM-DD'. Null when the table is empty. */
  oldest: string | null;
  /** True when rows were actually removed; false for a dry run. */
  applied: boolean;
}

/**
 * Report on — and optionally delete — usage counters older than `keepDays`.
 *
 * This table is the one that grows without bound as users arrive: one row per
 * owner, per day, per tool. At 10k users with 10% daily active that is ~3.3M
 * rows a year, and ~33M if they are all active daily. Left alone it becomes the
 * next `compat_edges`, and it holds display-only counters — its own schema
 * comment says an undercount on a DB hiccup is acceptable — so old rows are not
 * worth what they cost.
 *
 * DRY RUN BY DEFAULT. `apply` has to be passed explicitly, because this is the
 * only function in the codebase that removes production rows and a retention
 * sweep is not something that should be able to happen by accident, on a timer,
 * or as a side effect of calling something that sounds like a read.
 *
 * If a longer history is ever wanted, the upgrade is a monthly rollup table
 * written before the sweep, not a longer window on the daily rows.
 */
export async function pruneUsageCounters(
  db: Database,
  opts: { keepDays?: number; apply?: boolean } = {},
): Promise<UsageRetentionReport> {
  const keepDays = opts.keepDays ?? 90;
  const applied = opts.apply === true;
  const cutoff = sql`(current_date - make_interval(days => ${keepDays}))::date`;

  const [counts] = await db
    .select({
      stale: sql<number>`count(*) filter (where ${ownerUsageDaily.date} < ${cutoff})::int`,
      retained: sql<number>`count(*) filter (where ${ownerUsageDaily.date} >= ${cutoff})::int`,
      oldest: sql<string | null>`min(${ownerUsageDaily.date})::text`,
    })
    .from(ownerUsageDaily);

  const report: UsageRetentionReport = {
    stale: counts?.stale ?? 0,
    retained: counts?.retained ?? 0,
    oldest: counts?.oldest ?? null,
    applied,
  };
  if (!applied || report.stale === 0) return report;

  await db.delete(ownerUsageDaily).where(sql`${ownerUsageDaily.date} < ${cutoff}`);
  return report;
}
