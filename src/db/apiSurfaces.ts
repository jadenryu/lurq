/** Read/write helpers for the API-surface cache (`api_surfaces`, §4D). */
import { and, eq } from 'drizzle-orm';
import type { ExportSymbol } from '../core/types';
import type { Database } from './client';
import { apiSurfaces } from './schema';

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
