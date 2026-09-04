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
  enqueuePreviousSurface,
  enqueueSurface,
  getPendingSurfaces,
  isExtractionCached,
  storeSurface,
  surfaceRef,
} from '../db/surface';
import { getPackageVersions } from '../db/packages';
import { getPackagesMissingSurface, getPackagesWithSurface } from '../db/apiSurfaces';
import { fetchAndExtract } from '../surface/fetch';

/**
 * How far back to read the version timeline when locating a version's immediate
 * predecessor. Only the neighbour matters, but the timeline is newest-first and
 * a package can ship a burst of releases, so this is slack rather than a budget.
 */
const VERSION_LOOKBACK = 50;

/**
 * Bumped whenever extraction can produce a different answer for the same
 * tarball. '2' covers the ESM-first entry fallback and namespace member
 * resolution — both change what a package's surface is, neither changes a byte
 * of the artifact, and isExtractionCached now compares this so a stored surface
 * from an older extractor is treated as stale.
 */
const EXTRACTOR_VERSION = '2';
const MAX_ATTEMPTS = 3;

export interface SurfaceDrainSummary {
  drained: number;
  stored: number;
  cached: number;
  undeclared: number;
  failed: number;
  /** Predecessor versions queued so this one becomes diffable. */
  backfilled: number;
}

/** Extract and store one package version. Returns what happened, for the log. */
export type SurfaceOutcome = 'stored' | 'cached' | 'undeclared' | 'missing';

/**
 * Extract and persist one surface. Returns the outcome plus the version it
 * actually resolved to — the caller needs that to make the version *diffable*,
 * and `version` may have been null ("whatever latest is").
 */
export async function extractAndStore(
  db: Database,
  pkg: string,
  version: string | null,
): Promise<{ outcome: SurfaceOutcome; version: string | null }> {
  const fetched = await fetchAndExtract(pkg, version);
  if (!fetched) return { outcome: 'missing', version: null };

  const resolved = fetched.resolvedVersion;
  const ref = surfaceRef(pkg, resolved);
  if (await isExtractionCached(db, ref, fetched.artifactHash, EXTRACTOR_VERSION))
    return { outcome: 'cached', version: resolved };

  const res = await storeSurface(db, fetched.surface, {
    artifactHash: fetched.artifactHash,
    extractorVersion: EXTRACTOR_VERSION,
  });
  return {
    outcome: res.verdict === 'undeclared' ? 'undeclared' : 'stored',
    version: resolved,
  };
}

export async function drainSurfaceQueue(
  db: Database,
  opts: { limit?: number } = {},
): Promise<SurfaceDrainSummary> {
  const pending = await getPendingSurfaces(db, opts.limit ?? 10);
  const s: SurfaceDrainSummary = {
    drained: 0,
    stored: 0,
    cached: 0,
    undeclared: 0,
    failed: 0,
    backfilled: 0,
  };

  for (const item of pending) {
    s.drained++;
    try {
      const { outcome, version } = await extractAndStore(db, item.packageName, item.version);
      if (outcome === 'stored') s.stored++;
      else if (outcome === 'cached') s.cached++;
      else if (outcome === 'undeclared') s.undeclared++;

      // Make this version diffable by pulling its predecessor in behind it. A
      // surface alone says what a package exports; only a pair says what a
      // release *removed*, which is the thing a model trained before the release
      // cannot know and the reason any of this is worth extracting.
      //
      // Best-effort and never fatal: failing to queue a backfill must not fail
      // the extraction that succeeded.
      if (version && (outcome === 'stored' || outcome === 'cached')) {
        await enqueuePreviousSurface(
          db,
          item.packageName,
          version,
          await getPackageVersions(db, item.packageName, VERSION_LOOKBACK),
        ).then(
          (queued) => {
            if (queued) s.backfilled++;
          },
          (err) =>
            logger.warn(
              { pkg: item.packageName, version, err: formatError(err) },
              'surface: previous-version backfill could not be queued',
            ),
        );
      }
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

export interface BackfillSummary {
  scanned: number;
  /** Latest versions queued for packages that had no surface at all. */
  queuedLatest: number;
  /** Predecessors queued so an existing surface becomes diffable. */
  queuedPrevious: number;
}

/**
 * One-time backfill to give the existing catalog version depth.
 *
 * The publish hook in `watch` only sees releases from now on, so on its own it
 * would take as long as the catalog's release cadence to make anything
 * comparable. This walks what is already tracked and fills the two gaps behind
 * it: packages with no surface at all (half the catalog), and packages with one
 * surface and nothing to diff it against (all but ~4.5%).
 *
 * Enqueues only — it never fetches or extracts. The worker drains at whatever
 * rate its budget allows, so a backfill of the whole catalog cannot outrun the
 * registry or starve the demand-driven queue it shares.
 */
export async function backfillSurfaces(
  db: Database,
  opts: { limit?: number } = {},
): Promise<BackfillSummary> {
  const limit = opts.limit ?? 500;
  const s: BackfillSummary = { scanned: 0, queuedLatest: 0, queuedPrevious: 0 };

  // Gap 1: no surface at all. `getPackagesMissingSurface` already samples these.
  const missing = await getPackagesMissingSurface(db, limit);
  for (const row of missing) {
    s.scanned++;
    await enqueueSurface(db, row.name, row.version).then(
      () => {
        s.queuedLatest++;
      },
      (err: unknown) =>
        logger.warn({ pkg: row.name, err: formatError(err) }, 'backfill: could not queue latest'),
    );
  }

  // Gap 2: a surface exists but has no predecessor, so it cannot be diffed.
  // Sampled rather than ordered, for the same reason `getPackagesMissingSurface`
  // is: a package that can never gain a predecessor (its first ever release)
  // stays in this set forever, and a stable ordering would let the head of it
  // starve the tail indefinitely.
  const withSurface = await getPackagesWithSurface(db, limit);
  for (const row of withSurface) {
    s.scanned++;
    await enqueuePreviousSurface(
      db,
      row.name,
      row.version,
      await getPackageVersions(db, row.name, VERSION_LOOKBACK),
    ).then(
      (queued) => {
        if (queued) s.queuedPrevious++;
      },
      (err: unknown) =>
        logger.warn(
          { pkg: row.name, err: formatError(err) },
          'backfill: could not queue predecessor',
        ),
    );
  }
  return s;
}
