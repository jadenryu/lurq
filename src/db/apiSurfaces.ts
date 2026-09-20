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
 * `random()` keeps the pass advancing through the backlog; the attempt count on
 * `packages` keeps permanent failures out of it. A version that has failed
 * SURFACE_MAX_ATTEMPTS times is skipped until the package publishes a new one.
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
    .where(
      and(
        isNotNull(packages.latestVersion),
        isNull(apiSurfaces.id),
        sql`not (${packages.surfaceAttemptedVersion} is not distinct from ${packages.latestVersion} and ${packages.surfaceAttempts} >= ${SURFACE_MAX_ATTEMPTS})`,
      ),
    )
    .orderBy(sql`random()`)
    .limit(limit);
  return rows.filter((r): r is { name: string; version: string } => r.version !== null);
}

/** Extraction failures a version gets before the worker stops retrying it. */
export const SURFACE_MAX_ATTEMPTS = 3;

/**
 * Count one failed extraction of `version`. Counting restarts at 1 when the
 * version differs from the last one attempted, so a new release is always
 * given a fresh budget. One statement, so concurrent passes cannot lose a count.
 */
export async function recordSurfaceMiss(
  db: Database,
  name: string,
  version: string,
): Promise<void> {
  await db
    .update(packages)
    .set({
      surfaceAttempts: sql`case when ${packages.surfaceAttemptedVersion} = ${version} then ${packages.surfaceAttempts} + 1 else 1 end`,
      surfaceAttemptedVersion: version,
    })
    .where(eq(packages.name, name));
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

/**
 * Tracked packages whose latest version *does* have a surface — the input to the
 * predecessor backfill, which needs somewhere to start from.
 *
 * Randomly sampled for the same reason as {@link getPackagesMissingSurface}: a
 * package whose latest release is also its first can never gain a predecessor
 * and so never leaves this set, and a stable ordering would let those rows sit
 * at the head forever while the tail is never reached.
 */
export async function getPackagesWithSurface(
  db: Database,
  limit = 100,
): Promise<{ name: string; version: string }[]> {
  const rows = await db
    .select({ name: packages.name, version: packages.latestVersion })
    .from(packages)
    .innerJoin(
      apiSurfaces,
      and(
        eq(apiSurfaces.packageName, packages.name),
        eq(apiSurfaces.version, packages.latestVersion),
      ),
    )
    .where(isNotNull(packages.latestVersion))
    .orderBy(sql`random()`)
    .limit(limit);
  return rows.filter((r): r is { name: string; version: string } => r.version !== null);
}
