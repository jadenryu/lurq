/** Usage-axis serving layer (§4D): read-through the surface cache, extracting
 *  on a miss. Shared by the `usage` handler and the discovery worker (§4G). */
import type { ExportSymbol } from '../core/types';
import type { Database } from '../db/client';
import { getStoredSurface, upsertSurface } from '../db/apiSurfaces';
import { extractSurface } from './extract';

/**
 * The API surface for `name@version` from cache, or extract-and-store on a miss.
 * Returns null when types can't be resolved (caller falls back to README).
 * Cache-forever: versions are immutable.
 */
export async function getOrExtractSurface(
  db: Database,
  name: string,
  version: string,
): Promise<ExportSymbol[] | null> {
  const stored = await getStoredSurface(db, name, version);
  if (stored) return stored;
  const extracted = await extractSurface(name, version);
  if (extracted) await upsertSurface(db, name, version, extracted).catch(() => {});
  return extracted;
}
