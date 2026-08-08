/** Read/write helpers for the API-surface cache (`api_surfaces`, §4D). */
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { ExportSymbol } from '../core/types';
import type { Database } from './client';
import { apiSurfaces, packages } from './schema';

export async function getStoredSurface(
  db: Database,
  packageName: string,
  version: string,
): Promise<ExportSymbol[] | null> {
  const [row] = await db
    .select({ surface: apiSurfaces.surface })
    .from(apiSurfaces)
    .where(and(eq(apiSurfaces.packageName, packageName), eq(apiSurfaces.version, version)))
    .limit(1);
  return row?.surface ?? null;
}

/**
 * Tracked packages whose latest version has no extracted surface yet — the
 * worker's extraction backlog (§4G).
 *
 * A package that ships no types extracts to nothing and stores nothing, so it
 * stays in this result set forever. Unordered, that meant the worker pulled the
 * same head rows every cycle and never reached the tail: 96 cycles a day × 50
 * rows produced 357 surfaces against 3,316 packages.
 *
 * ponytail: `random()` guarantees the pass advances without a schema change, at
 * the cost of re-attempting permanent failures. If that retry waste starts
 * mattering, the upgrade is an `attempts`/`last_attempt_at` column on `packages`
 * (or a negative-cache row) plus exponential backoff — same shape as
 * `surface_queue.attempts` already uses on the demand-driven path.
 */
export async function getPackagesMissingSurface(
  db: Database,
  limit: number,
): Promise<{ name: string; version: string }[]> {
  const rows = await db
    .select({ name: packages.name, version: packages.latestVersion })
    .from(packages)
    .leftJoin(
      apiSurfaces,
      and(
        eq(apiSurfaces.packageName, packages.name),
        eq(apiSurfaces.version, packages.latestVersion),
      ),
    )
    .where(and(isNotNull(packages.latestVersion), isNull(apiSurfaces.id)))
    .orderBy(sql`random()`)
    .limit(limit);
  return rows.filter((r): r is { name: string; version: string } => r.version !== null);
}

/** Cache a version's surface. Versions are immutable, so a stored surface is
 *  authoritative; on the rare conflict we refresh rather than error. */
export async function upsertSurface(
  db: Database,
  packageName: string,
  version: string,
  surface: ExportSymbol[],
): Promise<void> {
  await db
    .insert(apiSurfaces)
    .values({ packageName, version, surface })
    .onConflictDoUpdate({
      target: [apiSurfaces.packageName, apiSurfaces.version],
      set: { surface, extractedAt: new Date() },
    });
}
