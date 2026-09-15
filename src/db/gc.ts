/**
 * Retention for bookkeeping rows that only ever accumulate. DRY RUN unless
 * `apply` is set, the same contract as `pruneUsageCounters`.
 *
 * Deliberately narrow. It only ever offers rows whose removal loses no history
 * and no account's data, and that something else rebuilds if they matter again:
 *
 *  - seed_packages entries that are not in the curated seed file. The on-demand
 *    path used to add these and nothing removed them, so the list the daily sync
 *    re-fetches in full every run only grew. Removing one drops it from the
 *    every-day set; its package row stays, and the publish feed and daily
 *    rotation keep it fresh.
 *  - discovery_queue rows the gate rejected, or whose ingest kept failing, older
 *    than the window. A name that publishes again is simply re-queued and
 *    re-judged.
 *  - finished sync_runs older than the window, an audit trail nobody reads past
 *    a few months.
 *
 * Everything else that grows — package_versions, api_surfaces, entities,
 * symbols, observations, mcp_contracts, mcp_observations, mcp_change_events —
 * is history the product reads (diffs, drift, change feeds). Those are reported
 * by size so the growth is visible, never offered for deletion here.
 */
import { and, inArray, lt, ne, notInArray, sql } from 'drizzle-orm';
import type { Database } from './client';
import { discoveryQueue, seedPackages, syncRuns } from './schema';

export const GC_DEFAULT_KEEP_DAYS = 180;

/** Tables reported by size only: history the product depends on. */
const GROWTH_TABLES = [
  'packages',
  'package_versions',
  'api_surfaces',
  'entities',
  'symbols',
  'observations',
  'mcp_contracts',
  'mcp_observations',
  'mcp_change_events',
  'discovery_queue',
  'surface_queue',
  'seed_packages',
  'sync_runs',
] as const;

export interface GcCategory {
  key: string;
  description: string;
  rows: number;
}

export interface GcTableSize {
  table: string;
  rows: number;
  bytes: number;
}

export interface GcReport {
  keepDays: number;
  categories: GcCategory[];
  tables: GcTableSize[];
  applied: boolean;
}

export async function gcReport(
  db: Database,
  opts: { curatedSeeds: string[]; keepDays?: number; apply?: boolean },
): Promise<GcReport> {
  const keepDays = opts.keepDays ?? GC_DEFAULT_KEEP_DAYS;
  const applied = opts.apply === true;
  const cutoff = sql`now() - make_interval(days => ${keepDays})`;

  // An empty curated list would classify every seed as prunable. Refuse rather
  // than guess: that is a broken seed file, not a retention decision.
  if (opts.curatedSeeds.length === 0) {
    throw new Error('gc: the curated seed list is empty; refusing to classify seed_packages');
  }

  const notCurated = notInArray(seedPackages.name, opts.curatedSeeds);
  const staleQueue = and(inArray(discoveryQueue.status, ['rejected', 'failed']), lt(discoveryQueue.discoveredAt, cutoff));
  const staleRuns = and(ne(syncRuns.status, 'running'), lt(syncRuns.startedAt, cutoff));

  const count = (n: { n: number }[]) => Number(n[0]?.n ?? 0);
  const [seeds, queue, runs] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(seedPackages).where(notCurated),
    db.select({ n: sql<number>`count(*)::int` }).from(discoveryQueue).where(staleQueue),
    db.select({ n: sql<number>`count(*)::int` }).from(syncRuns).where(staleRuns),
  ]);

  const categories: GcCategory[] = [
    { key: 'seed_packages', description: 'seed entries not in the curated seed file', rows: count(seeds) },
    { key: 'discovery_queue', description: `rejected or failed candidates older than ${keepDays}d`, rows: count(queue) },
    { key: 'sync_runs', description: `finished sync runs older than ${keepDays}d`, rows: count(runs) },
  ];

  const sizes = await db.execute(sql`
    select relname as table, n_live_tup::bigint as rows, pg_total_relation_size(relid)::bigint as bytes
    from pg_stat_user_tables
    where relname in (${sql.join(GROWTH_TABLES.map((t) => sql`${t}`), sql`, `)})
    order by pg_total_relation_size(relid) desc
  `);
  const sizeRows = ((sizes as { rows?: unknown[] }).rows ?? (sizes as unknown as unknown[])) as {
    table: string;
    rows: string | number;
    bytes: string | number;
  }[];
  const tables = sizeRows.map((r) => ({ table: r.table, rows: Number(r.rows), bytes: Number(r.bytes) }));

  const report: GcReport = { keepDays, categories, tables, applied };
  if (!applied || categories.every((c) => c.rows === 0)) return report;

  await db.transaction(async (tx) => {
    await tx.delete(seedPackages).where(notCurated);
    await tx.delete(discoveryQueue).where(staleQueue);
    await tx.delete(syncRuns).where(staleRuns);
  });
  return report;
}
