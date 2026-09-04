/**
 * Backfill for the direct/indirect dependent split (§9.4).
 *
 * `sync` records these going forward, but the existing 38k rows predate the
 * column and would only fill as the rotation came around — 52 days at the
 * current refresh cap, which is far too slow to build a retrieval eval on.
 *
 * Two ordering modes, because the two consumers want opposite things:
 *
 *   - `--stratify` walks every category, taking its most-downloaded rows first.
 *     This is the eval sampling frame: a query set drawn without stratifying
 *     would be a third `utility` and `styling`, which between them hold 13k of
 *     the 38k rows and answer almost no real need.
 *   - Without it, plain most-downloaded-first across the whole index — the right
 *     order for a long background pass, since the heavily-installed packages are
 *     the ones whose direct share actually changes a ranking.
 *
 * Resumable by construction: it only ever selects rows where the columns are
 * still null, so re-running continues rather than restarting, and an
 * interrupted pass loses nothing.
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { packages } from '../db/schema';
import { fetchDependents } from '../ingestion/sources/depsDev';
import { logger } from '../core/logger';

export interface BackfillStats {
  attempted: number;
  filled: number;
  /** deps.dev had no dependent data for the package (common for new/tiny ones). */
  missing: number;
  /** No latest_version stored, so there is nothing to query deps.dev with. */
  skipped: number;
}

export interface BackfillOptions {
  limit?: number;
  /** Take the top `perCategory` rows from every category instead of globally. */
  stratify?: boolean;
  perCategory?: number;
  /** Parallel deps.dev requests. Kept low; the shared HTTP layer also rate-limits per host. */
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
}

interface Target {
  name: string;
  version: string | null;
}

async function selectTargets(db: Database, opts: BackfillOptions): Promise<Target[]> {
  const limit = opts.limit ?? 2000;

  if (!opts.stratify) {
    return db
      .select({ name: packages.name, version: packages.latestVersion })
      .from(packages)
      .where(isNull(packages.directDependents))
      .orderBy(desc(packages.weeklyDownloads))
      .limit(limit);
  }

  // One window per category, most-downloaded first. Done in SQL rather than a
  // query per category so a 23-category walk stays a single round trip.
  const perCategory = opts.perCategory ?? 90;
  const rows = await db.execute(sql`
    select name, latest_version as version from (
      select name, latest_version,
             row_number() over (partition by category order by weekly_downloads desc nulls last) rn
      from ${packages}
      where direct_dependents is null and category is not null
    ) ranked
    where rn <= ${perCategory}
    limit ${limit}
  `);
  return ((rows as unknown as { rows?: Target[] }).rows ?? (rows as unknown as Target[])) ?? [];
}

export async function backfillDependents(
  db: Database,
  opts: BackfillOptions = {},
): Promise<BackfillStats> {
  const targets = await selectTargets(db, opts);
  const stats: BackfillStats = { attempted: 0, filled: 0, missing: 0, skipped: 0 };
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 6, 16));

  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const target = targets[cursor++];
      if (!target) return;
      if (!target.version) {
        stats.skipped++;
        continue;
      }
      stats.attempted++;
      try {
        const counts = await fetchDependents(target.name, target.version);
        if (!counts) {
          stats.missing++;
        } else {
          await db
            .update(packages)
            .set({ directDependents: counts.direct, indirectDependents: counts.indirect })
            .where(and(eq(packages.name, target.name), isNull(packages.directDependents)));
          stats.filled++;
        }
      } catch (err) {
        // A backfill must never die on one bad row; the next pass retries it
        // because the columns are still null.
        stats.missing++;
        logger.warn(`dependents: ${target.name} failed (${err instanceof Error ? err.message : String(err)})`);
      }
      opts.onProgress?.(stats.attempted + stats.skipped, targets.length);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return stats;
}
