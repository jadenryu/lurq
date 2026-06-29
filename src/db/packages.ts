/**
 * Read/write helpers for the `packages` table. All recommendation/eval reads use
 * this single denormalized table (§8.2).
 */
import { desc, eq } from 'drizzle-orm';
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
