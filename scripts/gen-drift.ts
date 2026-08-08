/**
 * Generates apps/web/src/content/generated/drift.json: for each model cutoff the
 * board can be set to, the packages that shipped a new major version after that
 * date, ranked by how many installs a week they get.
 *
 *   npx tsx scripts/gen-drift.ts
 *
 * The point of the page section this feeds is that a model's answer about a
 * package is a memory with a date on it. This is the measurable form of that: at
 * the model's cutoff these packages were on one major, and today they are on a
 * different one. A model trained up to that date answers with the old number,
 * confidently, and has no way to know it is stale.
 *
 * One bucket per distinct date in MODEL_CUTOFFS, which is the single source of
 * truth for those dates and carries a vendor URL for every one of them. Two
 * models on the same cutoff are the same query, so they share a bucket and the
 * picker just points at it.
 *
 * READ ONLY. Every query below is a SELECT. Nothing in this script writes to the
 * database, enqueues work, or touches the registry, so it is safe to run against
 * production. It is still worth pointing LURQ_ENV_FILE at a non-production env if
 * one is available.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { createDb } from '../src/db/client';
import { CUTOFF_DATES } from '../apps/web/src/content/model-cutoffs';

const OUT = path.join(process.cwd(), 'apps/web/src/content/generated/drift.json');

/** How many rows each board shows. */
const LIMIT = 8;

interface Row {
  name: string;
  major_then: number;
  version_then: string;
  major_now: number;
  version_now: string;
  bumped_at: string;
  majors_since: number;
  weekly_downloads: number | null;
}

interface Bucket {
  totals: { drifted: number; tracked: number };
  rows: Row[];
}

type Db = ReturnType<typeof createDb>['db'];

/** One board: the top drifted packages as of `cutoff`, plus the totals behind them. */
async function buildBucket(db: Db, cutoff: string): Promise<Bucket> {
  const result = await db.execute(sql`
      with stable as (
        select
          package_name,
          version,
          published_at,
          (regexp_match(version, '^([0-9]+)\\.'))[1]::int as major
        from package_versions
        where published_at is not null
          -- Stable releases only. A prerelease major is not what an agent installs.
          and version ~ '^[0-9]+\\.[0-9]+\\.[0-9]+$'
      ),
      -- Where each package stood at the reference date.
      then_state as (
        select distinct on (package_name)
          package_name, major as major_then, version as version_then
        from stable
        where published_at < ${cutoff}::timestamptz
        order by package_name, major desc, published_at desc
      ),
      -- Where it stands now.
      now_state as (
        select distinct on (package_name)
          package_name, major as major_now, version as version_now
        from stable
        order by package_name, major desc, published_at desc
      ),
      -- When the current major first appeared, and how many majors landed since.
      bump as (
        select
          s.package_name,
          min(s.published_at) filter (where s.major = n.major_now) as bumped_at,
          count(distinct s.major) filter (
            where s.published_at >= ${cutoff}::timestamptz and s.major > t.major_then
          ) as majors_since
        from stable s
        join now_state n on n.package_name = s.package_name
        join then_state t on t.package_name = s.package_name
        group by s.package_name
      )
      select
        t.package_name                as name,
        t.major_then                  as major_then,
        t.version_then                as version_then,
        n.major_now                   as major_now,
        n.version_now                 as version_now,
        to_char(b.bumped_at, 'YYYY-MM-DD') as bumped_at,
        b.majors_since::int           as majors_since,
        p.weekly_downloads::bigint    as weekly_downloads
      from then_state t
      join now_state n on n.package_name = t.package_name
      join bump b      on b.package_name = t.package_name
      join packages p  on p.name = t.package_name
      where n.major_now > t.major_then
        and b.bumped_at >= ${cutoff}::timestamptz
        and p.weekly_downloads is not null
        and p.deprecated = false
      order by p.weekly_downloads desc
      limit ${LIMIT}
    `);

    // postgres.js hands back bigint and count() as strings; the page does
    // arithmetic on both, so they are coerced once here rather than at every
    // call site.
    const rows = (((result as { rows?: unknown[] }).rows ?? result) as Record<string, unknown>[]).map(
      (r): Row => ({
        name: String(r.name),
        major_then: Number(r.major_then),
        version_then: String(r.version_then),
        major_now: Number(r.major_now),
        version_now: String(r.version_now),
        bumped_at: String(r.bumped_at),
        majors_since: Number(r.majors_since),
        weekly_downloads: r.weekly_downloads == null ? null : Number(r.weekly_downloads),
      }),
    );
  if (!rows.length) {
    throw new Error(`drift query returned no rows for cutoff ${cutoff}. Nothing written.`);
  }

    // A total across the whole index, so the board's rows read as a sample of
    // something rather than as the whole story.
    //
    // Same population as the rows above, which it was not until now: the rows
    // dropped deprecated packages and ones with no download figure, and this
    // count kept them, so the eight packages on screen and the percentage over
    // them were drawn from two different sets. Small in effect — 120 rows of
    // 7,156, worth about half a point — and indefensible in kind, because this
    // is the one number on the page that invites a reader to check it.
    //
    // No install floor, and that is still a measured decision rather than an
    // oversight, though not for the reason it used to be. The old note here
    // said there was no tail to cut, which was true of a hand-seeded index of
    // 3,241 packages where only 91 sat below 10k a week. The crawl has since
    // taken it past 7,000 and 1,564 of those are below 10k, so there is now a
    // real tail — it just does not drift differently. By weekly-install band,
    // measured 2026-08-08 at the may-2026 cutoff:
    //
    //     <10k      7.9%      100k-1M    9.4%      >10M    8.1%
    //     10k-100k  5.0%      1M-10M    11.0%
    //
    // The relationship is not monotonic and barely a relationship at all: the
    // hardest-drifting band is 1M-10M, in the middle, and cutting the tail
    // moves the total by a rounding error. Weighting by installs rather than
    // counting packages gives 8.9% against 8.5%, which is the same answer.
    // A filter that changes the population and not the number is a filter that
    // exists to answer a question rather than to change an answer.
    const totalResult = await db.execute(sql`
      with stable as (
        select package_name, published_at,
               (regexp_match(version, '^([0-9]+)\\.'))[1]::int as major
        from package_versions
        where published_at is not null and version ~ '^[0-9]+\\.[0-9]+\\.[0-9]+$'
      ),
      eligible as (
        select name from packages
        where weekly_downloads is not null and deprecated = false
      ),
      then_state as (
        select s.package_name, max(s.major) as major_then
        from stable s join eligible e on e.name = s.package_name
        where s.published_at < ${cutoff}::timestamptz group by s.package_name
      ),
      now_state as (
        select s.package_name, max(s.major) as major_now
        from stable s join eligible e on e.name = s.package_name
        group by s.package_name
      )
      select count(*)::int as drifted,
             (select count(*)::int from then_state) as tracked
      from then_state t join now_state n using (package_name)
      where n.major_now > t.major_then
    `);
  const rawTotals = (((totalResult as { rows?: unknown[] }).rows ?? totalResult) as Record<
    string,
    unknown
  >[])[0]!;

  return {
    totals: {
      drifted: Number(rawTotals.drifted),
      tracked: Number(rawTotals.tracked),
    },
    rows,
  };
}

async function main(): Promise<void> {
  const { db, close } = createDb({ max: 1 });
  try {
    // Sequentially, on one connection. Six cutoffs against a Neon instance that
    // is already near its size limit is not the place to open a pool and fan out.
    const buckets: Record<string, Bucket> = {};
    for (const cutoff of CUTOFF_DATES) {
      buckets[cutoff] = await buildBucket(db, cutoff);
      const { drifted, tracked } = buckets[cutoff]!.totals;
      console.error(`  ${cutoff}: ${drifted} of ${tracked} drifted`);
    }

    const payload = {
      generatedAt: new Date().toISOString(),
      source: 'lurq index: package_versions joined to packages',
      /** Re-runnable by anyone with database access. */
      reproduce: 'npx tsx scripts/gen-drift.ts',
      /** Newest first, matching the picker. Keys of `buckets`. */
      cutoffs: CUTOFF_DATES,
      buckets,
    };

    await mkdir(path.dirname(OUT), { recursive: true });
    await writeFile(OUT, `${JSON.stringify(payload, null, 2)}\n`);
    console.error(`wrote ${path.relative(process.cwd(), OUT)} (${CUTOFF_DATES.length} buckets)`);
  } finally {
    await close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
