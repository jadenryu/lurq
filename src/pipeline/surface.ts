/**
 * Surface-extraction drain (§6.1).
 *
 * Services the demand-driven queue: fetch the tarball, check the digest against
 * the extraction cache, extract, store. Runs off the query path, which is what
 * lets a query answer UNKNOWN in milliseconds instead of blocking on a download.
 *
 * Failure handling follows §4.2: infrastructure problems bump the attempt count
 * and leave the spec queued, they never record a verdict about the package. A
 * rate limit is not evidence about anyone's API.
 */
import { formatError } from '../core/errors';
import { logger } from '../core/logger';
import type { Database } from '../db/client';
import {
  bumpSurfaceAttempt,
  dropSurfaceQueue,
  getPendingSurfaces,
  isExtractionCached,
  storeSurface,
  surfaceRef,
} from '../db/surface';
import { fetchAndExtract } from '../surface/fetch';

const EXTRACTOR_VERSION = '1';
const MAX_ATTEMPTS = 3;

export interface SurfaceDrainSummary {
  drained: number;
  stored: number;
  cached: number;
  undeclared: number;
  failed: number;
}

/** Extract and store one package version. Returns what happened, for the log. */
export async function extractAndStore(
  db: Database,
  pkg: string,
  version: string | null,
): Promise<'stored' | 'cached' | 'undeclared' | 'missing'> {
  const fetched = await fetchAndExtract(pkg, version);
  if (!fetched) return 'missing';

  const ref = surfaceRef(pkg, fetched.resolvedVersion);
  if (await isExtractionCached(db, ref, fetched.artifactHash)) return 'cached';

  const res = await storeSurface(db, fetched.surface, {
    artifactHash: fetched.artifactHash,
    extractorVersion: EXTRACTOR_VERSION,
  });
  return res.verdict === 'undeclared' ? 'undeclared' : 'stored';
}

export async function drainSurfaceQueue(
  db: Database,
  opts: { limit?: number } = {},
): Promise<SurfaceDrainSummary> {
  const pending = await getPendingSurfaces(db, opts.limit ?? 10);
  const s: SurfaceDrainSummary = { drained: 0, stored: 0, cached: 0, undeclared: 0, failed: 0 };

  for (const item of pending) {
    s.drained++;
    try {
      const outcome = await extractAndStore(db, item.packageName, item.version);
      if (outcome === 'stored') s.stored++;
      else if (outcome === 'cached') s.cached++;
      else if (outcome === 'undeclared') s.undeclared++;
      // `missing` means the registry has no such version — drop it, since
      // requeueing a nonexistent spec would spin forever.
      await dropSurfaceQueue(db, item.id);
    } catch (err) {
      s.failed++;
      // Infrastructure failure. Leave it queued unless it keeps failing; never
      // record a verdict about the package from our own outage.
      if (item.attempts + 1 >= MAX_ATTEMPTS) await dropSurfaceQueue(db, item.id);
      else await bumpSurfaceAttempt(db, item.id);
      logger.warn(
        { spec: item.specKey, attempts: item.attempts + 1, err: formatError(err) },
        'surface extraction failed',
      );
    }
  }
  return s;
}
