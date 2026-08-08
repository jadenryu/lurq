/**
 * One-off: recount `compat_edges.witness_count` from `resolved_closures`.
 *
 * The daily re-mine pass (§4B trigger 2) used to accrue +1 per pair per run, so
 * the stored value became `true_witnesses × passes_the_row_existed_for` — a count
 * of cron runs, not of distinct resolved graphs. Mining no longer accrues (see
 * `upsertObservedEdgesRemine`), which freezes the drift but cannot undo it: the
 * column is a running total and the per-row multiplier is unrecoverable (`ran_at`
 * was overwritten every pass). The only way back is to recount from the closures.
 *
 *   npx tsx scripts/backfill-witness-counts.mts               # dry run, writes nothing
 *   npx tsx scripts/backfill-witness-counts.mts --apply       # writes
 *   LURQ_ENV_FILE=.env.production npx tsx … --apply           # against prod
 *
 * Chunked on purpose. One 1.27M-row statement doubles the heap in dead tuples
 * (184 MB → ~363 MB) and on Neon that bloat sits in instant-restore storage for
 * the whole history window; chunking lets autovacuum reclaim as it goes so peak
 * storage stays roughly flat. `witness_count` is in no index, so the updates are
 * HOT — the 177 MB of indexes are not rewritten.
 */
import { loadEnv, requireConfig } from '../src/core/config';
import { createDb } from '../src/db/client';
import { logger } from '../src/core/logger';
import { sql } from 'drizzle-orm';

loadEnv();
const { DATABASE_URL } = requireConfig(['DATABASE_URL']);

const APPLY = process.argv.includes('--apply');
const CHUNK = Number(process.argv.find((a) => a.startsWith('--chunk='))?.split('=')[1] ?? 50_000);

/** Distinct resolved graphs each tracked pair actually appears in. Mirrors
 *  `trackedPairs()`: tracked endpoints only, same-package pairs skipped. */
const TRUTH = sql`
  create temp table witness_truth as
  with cn as (
    select distinct rc.package_name pk, rc.version pv, n->>'name' nm, n->>'version' nv
    from resolved_closures rc, jsonb_array_elements(rc.nodes) n
    where exists (select 1 from packages p where p.name = n->>'name')
  ),
  pairs as (
    select a.pk, a.pv,
           case when a.nm <= b.nm then a.nm else b.nm end xa,
           case when a.nm <= b.nm then a.nv else b.nv end xv,
           case when a.nm <= b.nm then b.nm else a.nm end ya,
           case when a.nm <= b.nm then b.nv else a.nv end yv
    from cn a join cn b on a.pk = b.pk and a.pv = b.pv and a.nm < b.nm
  )
  select xa, xv, ya, yv, count(*)::int true_w from pairs group by 1, 2, 3, 4`;

const handle = createDb({ max: 2 });
const { db } = handle;
const host = new URL(DATABASE_URL!).host;

try {
  logger.info(`Target: ${host}  |  mode: ${APPLY ? 'APPLY (writes)' : 'dry run (no writes)'}`);

  const t0 = Date.now();
  await db.execute(TRUTH);
  await db.execute(sql`create index on witness_truth (xa, xv, ya, yv)`);
  const [truth] = (await db.execute(
    sql`select count(*)::int n from witness_truth`,
  )) as unknown as { n: number }[];
  logger.info(`Recounted ${truth!.n} pairs from closures in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);

  // What the recount cannot speak for: edges with no closure behind them (the
  // Tier-2 resolve-only checker, §4C). Left untouched, and reported — never
  // silently folded into the "done" count.
  const [scope] = (await db.execute(sql`
    select count(*)::int total,
           count(t.true_w)::int recountable,
           count(*) filter (where t.true_w is null)::int no_closure,
           count(*) filter (where t.true_w is distinct from e.witness_count and t.true_w is not null)::int will_change
    from compat_edges e
    left join witness_truth t
      on e.package_a = t.xa and e.version_a = t.xv and e.package_b = t.ya and e.version_b = t.yv
  `)) as unknown as { total: number; recountable: number; no_closure: number; will_change: number }[];
  logger.info(
    `Edges: ${scope!.total} total, ${scope!.recountable} recountable, ` +
      `${scope!.no_closure} with no closure (left alone), ${scope!.will_change} would change.`,
  );

  const [before] = (await db.execute(sql`
    select round(avg(e.witness_count))::int stored_avg, round(avg(t.true_w), 2)::text true_avg,
           percentile_disc(0.5) within group (order by e.witness_count)::int stored_median,
           percentile_disc(0.5) within group (order by t.true_w)::int true_median
    from compat_edges e join witness_truth t
      on e.package_a = t.xa and e.version_a = t.xv and e.package_b = t.ya and e.version_b = t.yv
  `)) as unknown as Record<string, unknown>[];
  logger.info(`Before: ${JSON.stringify(before)}`);

  if (!APPLY) {
    logger.info('Dry run — nothing written. Re-run with --apply to commit.');
  } else {
    const [{ max_id }] = (await db.execute(
      sql`select coalesce(max(id), 0)::int max_id from compat_edges`,
    )) as unknown as { max_id: number }[];

    let updated = 0;
    for (let lo = 0; lo <= max_id; lo += CHUNK) {
      const res = (await db.execute(sql`
        update compat_edges e set witness_count = t.true_w
        from witness_truth t
        where e.id > ${lo} and e.id <= ${lo + CHUNK}
          and e.package_a = t.xa and e.version_a = t.xv
          and e.package_b = t.ya and e.version_b = t.yv
          and e.witness_count <> t.true_w
      `)) as unknown as { count?: number };
      updated += res.count ?? 0;
      if ((lo / CHUNK) % 5 === 0 || lo + CHUNK > max_id) {
        logger.info(`  …id ≤ ${Math.min(lo + CHUNK, max_id)}/${max_id}, ${updated} rows corrected`);
      }
    }
    logger.info(`Corrected ${updated} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);

    const [after] = (await db.execute(sql`
      select count(*)::int mismatched from compat_edges e join witness_truth t
        on e.package_a = t.xa and e.version_a = t.xv and e.package_b = t.ya and e.version_b = t.yv
      where e.witness_count <> t.true_w
    `)) as unknown as { mismatched: number }[];
    logger.info(
      after!.mismatched === 0
        ? 'Verified: every recountable edge now matches its true closure count.'
        : `WARNING: ${after!.mismatched} edges still mismatched.`,
    );
  }
} finally {
  await handle.close();
}
