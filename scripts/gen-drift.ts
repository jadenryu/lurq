/**
 * Generates apps/web/src/content/generated/drift.json: the packages that shipped
 * a new major version after a reference date, ranked by how many installs a week
 * they get.
 *
 *   npx tsx scripts/gen-drift.ts
 *
 * The point of the page section this feeds is that a model's answer about a
 * package is a memory with a date on it. This is the measurable form of that: at
 * the reference date these packages were on one major, and today they are on a
 * different one. Anything trained on or before that date will answer with the
 * old number, confidently.
 *
 * READ ONLY. The query below is a single SELECT. Nothing in this script writes to
 * the database, enqueues work, or touches the registry, so it is safe to run
 * against production. It is still worth pointing LURQ_ENV_FILE at a non-production
 * env if one is available.
 *
 * On the reference date: there is no API that publishes training cutoffs, and
 * guessing per-model dates would put a claim on the page that nobody can check.
 * So the section names a single date, says plainly that it is an approximation of
 * where current coding models sit, and lets every number under it be exact.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { createDb } from '../src/db/client';

const OUT = path.join(process.cwd(), 'apps/web/src/content/generated/drift.json');

/**
 * Roughly where the coding models in common use today stop. Deliberately a round
 * date rather than a specific model's published cutoff: the page says "around
 * here", and the honesty is in not pretending to more precision than exists.
 */
const CUTOFF = '2025-03-01';

/** How many rows the board shows. */
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

async function main(): Promise<void> {
  const { db, close } = createDb({ max: 1 });
  try {
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
        where published_at < ${CUTOFF}::timestamptz
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
            where s.published_at >= ${CUTOFF}::timestamptz and s.major > t.major_then
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
        and b.bumped_at >= ${CUTOFF}::timestamptz
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
      throw new Error('drift query returned no rows. Nothing written.');
    }

    // A total across the whole index, so the board's rows read as a sample of
    // something rather than as the whole story.
    const totalResult = await db.execute(sql`
      with stable as (
        select package_name, published_at,
               (regexp_match(version, '^([0-9]+)\\.'))[1]::int as major
        from package_versions
        where published_at is not null and version ~ '^[0-9]+\\.[0-9]+\\.[0-9]+$'
      ),
      then_state as (
        select package_name, max(major) as major_then from stable
        where published_at < ${CUTOFF}::timestamptz group by package_name
      ),
      now_state as (
        select package_name, max(major) as major_now from stable group by package_name
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
    const totals = {
      drifted: Number(rawTotals.drifted),
      tracked: Number(rawTotals.tracked),
    };

    const payload = {
      generatedAt: new Date().toISOString(),
      source: 'lurq index: package_versions joined to packages',
      /** Re-runnable by anyone with database access. */
      reproduce: 'npx tsx scripts/gen-drift.ts',
      cutoff: CUTOFF,
      totals,
      rows,
    };

    await mkdir(path.dirname(OUT), { recursive: true });
    await writeFile(OUT, `${JSON.stringify(payload, null, 2)}\n`);
    console.error(
      `wrote ${path.relative(process.cwd(), OUT)}\n` +
        `  cutoff:  ${CUTOFF}\n` +
        `  drifted: ${totals.drifted} of ${totals.tracked} tracked packages\n` +
        `  rows:    ${rows.length}`,
    );
  } finally {
    await close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
