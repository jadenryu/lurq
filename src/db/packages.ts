/**
 * Read/write helpers for the `packages` table. All recommendation/eval reads use
 * this single denormalized table (§8.2).
 */
import { and, desc, eq, isNotNull, isNull, notExists, sql } from 'drizzle-orm';
import type { Category } from '../core/types';
import type { VersionInfo } from '../ingestion/types';
import type { Database } from './client';
import {
  packageVersions,
  packages,
  seedPackages,
  syncRuns,
  type NewPackageRow,
  type SyncError,
} from './schema';

/** How many rows to insert per statement (stays well under Postgres' param cap). */
const VERSION_CHUNK = 500;

export async function getSeedTargets(
  db: Database,
): Promise<{ name: string; category: Category | null }[]> {
  const rows = await db
    .select({ name: seedPackages.name, category: seedPackages.category })
    .from(seedPackages);
  return rows.map((r) => ({ name: r.name, category: r.category ?? null }));
}

/**
 * The daily sync's rotation slice: the stalest tracked packages that aren't in
 * `seed_packages`. Discovery ingests thousands of packages `getSeedTargets`
 * never returns, so without this their scores — and their `latest_version` —
 * stay frozen at the moment they were ingested.
 *
 * A frozen `latest_version` also closes the discovery frontier: `graphChannel`
 * (§2B) only re-expands a package whose version moved, so a package that is
 * never refreshed can never re-arm, and the crawler flatlines once the initial
 * BFS converges. This rotation is what keeps it open.
 *
 * Only a `curated` category is carried through. An `inferred` one is left null
 * so the pipeline re-infers it — passing it back in would make the refresh
 * silently relabel it `curated`, and a later curation pass would then skip it.
 */
export async function getStaleRefreshTargets(
  db: Database,
  limit: number,
): Promise<{ name: string; category: Category | null }[]> {
  if (limit <= 0) return [];
  const rows = await db
    .select({
      name: packages.name,
      category: sql<
        Category | null
      >`case when ${packages.categorySource} = 'curated' then ${packages.category} end`,
    })
    .from(packages)
    .where(
      notExists(
        db
          .select({ one: sql`1` })
          .from(seedPackages)
          .where(eq(seedPackages.name, packages.name)),
      ),
    )
    // Never-synced rows (null `data_as_of`) are the stalest of all, and ASC puts
    // nulls last in Postgres — so say it explicitly.
    .orderBy(sql`${packages.dataAsOf} asc nulls first`)
    .limit(limit);
  return rows.map((r) => ({ name: r.name, category: r.category ?? null }));
}

export async function getPackageByName(db: Database, name: string) {
  const rows = await db.select().from(packages).where(eq(packages.name, name)).limit(1);
  return rows[0] ?? null;
}

/** Every tracked package name — the set the `_changes` follower filters against. */
export async function getAllPackageNames(db: Database): Promise<string[]> {
  const rows = await db.select({ name: packages.name }).from(packages);
  return rows.map((r) => r.name);
}

/**
 * Store a package's version timeline. Idempotent — versions are immutable on
 * npm, so existing rows are left untouched. Chunked to respect the param cap.
 */
export async function upsertPackageVersions(
  db: Database,
  name: string,
  versions: VersionInfo[],
): Promise<void> {
  if (versions.length === 0) return;
  for (let i = 0; i < versions.length; i += VERSION_CHUNK) {
    const rows = versions.slice(i, i + VERSION_CHUNK).map((v) => ({
      packageName: name,
      version: v.version,
      publishedAt: v.publishedAt,
    }));
    await db.insert(packageVersions).values(rows).onConflictDoNothing();
  }
}

/** A package's stored version timeline, newest first. */
export async function getPackageVersions(
  db: Database,
  name: string,
  limit = 50,
): Promise<VersionInfo[]> {
  const rows = await db
    .select({ version: packageVersions.version, publishedAt: packageVersions.publishedAt })
    .from(packageVersions)
    .where(eq(packageVersions.packageName, name))
    .orderBy(desc(packageVersions.publishedAt))
    .limit(limit);
  return rows.map((r) => ({ version: r.version, publishedAt: r.publishedAt }));
}

/**
 * The most-downloaded tracked packages — the reference set typosquat detection
 * compares a queried name against. Capped (default 1000) so the per-verify
 * distance scan stays cheap.
 */
export async function getTopPackageNames(db: Database, limit = 1000): Promise<string[]> {
  const rows = await db
    .select({ name: packages.name })
    .from(packages)
    .where(isNotNull(packages.weeklyDownloads))
    .orderBy(desc(packages.weeklyDownloads))
    .limit(limit);
  return rows.map((r) => r.name);
}

/**
 * Promote a package into the curated seed list so future `sync` runs keep it
 * fresh. Used by the on-demand path (§12.5) to make organically-discovered
 * packages durable. No-op if already seeded — preserves the original category
 * and `added_at` rather than overwriting a hand-curated entry.
 */
export async function ensureSeedEntry(
  db: Database,
  name: string,
  category: Category | null,
): Promise<void> {
  await db
    .insert(seedPackages)
    .values({ name, category })
    .onConflictDoNothing({ target: seedPackages.name });
}

/** Upsert a fully-computed package row, refreshing every field on conflict. */
export async function upsertPackage(db: Database, row: NewPackageRow): Promise<void> {
  const { name: _name, createdAt: _createdAt, ...mutable } = row;
  await db
    .insert(packages)
    .values(row)
    .onConflictDoUpdate({
      target: packages.name,
      set: { ...mutable, updatedAt: new Date() },
    });
}

/**
 * Credit the individual account whose on-demand query first caused `name` to be
 * ingested. A standalone, idempotent UPDATE guarded by `IS NULL` — kept OUT of
 * upsertPackage (which refreshes every field on conflict) so re-syncs and the
 * `_changes` watcher, which never pass an owner, can never clobber the credit.
 * The `IS NULL` guard is also the cross-process race tie-breaker: whichever
 * concurrent first-ingest commits first wins; the rest match zero rows.
 */
export async function stampFirstRequester(
  db: Database,
  name: string,
  ownerId: string,
): Promise<void> {
  await db
    .update(packages)
    .set({ firstRequestedByOwnerId: ownerId })
    .where(and(eq(packages.name, name), isNull(packages.firstRequestedByOwnerId)));
}

export interface Contribution {
  name: string;
  category: Category | null;
  healthScore: number | null;
  /** = packages.createdAt (immutable since first insert). */
  firstRequestedAt: Date;
}

/**
 * Packages this account first caused to be ingested (dashboard v1 phase 2),
 * newest first, plus the total for pagination. `firstRequestedAt` is the row's
 * immutable `createdAt`, so no separate timestamp column is needed.
 */
export async function getContributionsByOwner(
  db: Database,
  ownerId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ total: number; packages: Contribution[] }> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const [rows, [countRow]] = await Promise.all([
    db
      .select({
        name: packages.name,
        category: packages.category,
        healthScore: packages.healthScore,
        firstRequestedAt: packages.createdAt,
      })
      .from(packages)
      .where(eq(packages.firstRequestedByOwnerId, ownerId))
      .orderBy(desc(packages.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(packages)
      .where(eq(packages.firstRequestedByOwnerId, ownerId)),
  ]);
  return { total: countRow?.count ?? 0, packages: rows };
}

// ── sync_runs audit ─────────────────────────────────────────────────────────

export async function startSyncRun(db: Database): Promise<number> {
  const [row] = await db
    .insert(syncRuns)
    .values({ status: 'running' })
    .returning({ id: syncRuns.id });
  return row!.id;
}

export async function finishSyncRun(
  db: Database,
  id: number,
  data: {
    packagesSeen: number;
    packagesUpdated: number;
    errors: SyncError[];
    status: 'success' | 'partial' | 'failed';
  },
): Promise<void> {
  await db
    .update(syncRuns)
    .set({
      finishedAt: new Date(),
      packagesSeen: data.packagesSeen,
      packagesUpdated: data.packagesUpdated,
      errors: data.errors,
      status: data.status,
    })
    .where(eq(syncRuns.id, id));
}
