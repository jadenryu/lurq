/**
 * Block-on-first-touch for the graph surface store.
 *
 * `resolve_surface` and `diff_surface` read the entities/symbols store, and on a
 * miss they used to enqueue the package and return `unknown` immediately. Every
 * other read path in lurq does the opposite: `evaluate` and `verify` ingest
 * synchronously within a budget, and `usage` extracts within
 * USAGE_EXTRACT_BUDGET_MS. So the two tools with no npm equivalent — the ones
 * `check-upgrade` is built on — were the only ones that answered "I don't know"
 * to a question they could have answered in half a second.
 *
 * The consequence was structural, not incidental. A store that only fills from
 * queue drains grows at the rate of the drain; a store that fills from demand
 * grows at the rate of demand. That is the whole reason `api_surfaces` reached
 * 26.9k packages while this store sat at 2.9k, on the same extractor at 0.52s a
 * package.
 *
 * This mirrors `usage/service.ts` deliberately rather than inventing a second
 * policy: same in-flight join, same bounded map, same "the caller gave up but
 * the extraction keeps going so the next request is a hit" behaviour. Where it
 * differs is the writer — `extractAndStore` populates entities/claims/
 * observations/symbols, which is what makes a surface *diffable* rather than
 * just listable.
 */
import { withBudget } from '../core/concurrency';
import type { Database } from '../db/client';
import { logger } from '../core/logger';

/**
 * Wall-clock ceiling for a cold miss on a request path.
 *
 * Sized against measured throughput (0.52s per extraction) with room for a slow
 * CDN, and deliberately larger than a single extraction because `diff_surface`
 * needs two and races them together. A caller that exceeds it still leaves the
 * extraction running — the cost has already been paid, and abandoning the write
 * would mean a slow package is never extracted on this path at all.
 */
export const SURFACE_FIRST_TOUCH_BUDGET_MS = 4000;

/**
 * Cap on concurrent extractions started from the request path.
 *
 * A flood of distinct versions must not grow memory without bound — the same
 * reason `usage` and the ingest queue cap theirs. Past the cap a miss degrades
 * to the existing queued-and-unknown response, which is a correct answer, just
 * a slower one.
 */
const MAX_INFLIGHT = 64;

/** Extractions in progress, keyed `name@version`, so N concurrent misses for the
 *  same version share one tarball fetch instead of starting N. */
const inFlight = new Map<string, Promise<string | null>>();

/**
 * Start, or join, the single extraction for this package version.
 *
 * Returns the resolved version on success and null on any failure. Failure is
 * never fatal here: the caller falls back to the queued-and-unknown response it
 * would have returned anyway, so a broken CDN degrades this path to exactly the
 * old behaviour rather than to an error.
 */
function extractOnce(db: Database, pkg: string, version: string | null): Promise<string | null> {
  const key = `${pkg}@${version ?? 'latest'}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  if (inFlight.size >= MAX_INFLIGHT) return Promise.resolve(null);

  const task = (async () => {
    // Imported lazily and on purpose. Extraction pulls in the TypeScript
    // compiler, and a static import here would put it on the boot path of every
    // command that touches the MCP handlers — the same trap `worker.ts`
    // documents for `extractSurfacesPass`.
    const { extractAndStore } = await import('./surface');
    const { outcome, version: resolved } = await extractAndStore(db, pkg, version);
    // 'missing' means no artifact to read; 'undeclared' means a real artifact
    // that exports nothing this tier can see. Neither is a stored surface, and
    // reporting either as success would make the caller re-read and find
    // nothing, converting a slow answer into a wrong one.
    return outcome === 'stored' || outcome === 'cached' ? resolved : null;
  })()
    .catch((err) => {
      logger.warn(
        `surface first-touch failed for ${key}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, task);
  return task;
}

/**
 * Extract one surface into the graph store, bounded by a budget.
 *
 * `null` means "not available within the budget" — which covers a genuine
 * failure and a slow-but-still-running extraction identically, because the
 * caller's next move is the same either way: return the honest unknown and let
 * the warmed cache serve the retry.
 */
export function firstTouchSurface(
  db: Database,
  pkg: string,
  version: string | null,
  budgetMs: number = SURFACE_FIRST_TOUCH_BUDGET_MS,
): Promise<string | null> {
  const task = extractOnce(db, pkg, version);
  return budgetMs <= 0 ? Promise.resolve(null) : withBudget(task, budgetMs).then((v) => v ?? null);
}

/**
 * Extract both sides of a diff under ONE shared budget.
 *
 * Sequential extraction would let a slow `from` consume the whole budget and
 * leave `to` unstarted, so the pair is raced together: both are in flight
 * immediately and the budget bounds the pair rather than each half. Returns
 * whether both sides landed, since a diff with one side missing is not a diff —
 * it is the empty-surface comparison the diff guards already refuse.
 */
export async function firstTouchPair(
  db: Database,
  pkg: string,
  fromVersion: string | null,
  toVersion: string | null,
  budgetMs: number = SURFACE_FIRST_TOUCH_BUDGET_MS,
): Promise<boolean> {
  if (budgetMs <= 0) return false;
  const pair = Promise.all([extractOnce(db, pkg, fromVersion), extractOnce(db, pkg, toVersion)]);
  const settled = await withBudget(pair, budgetMs);
  return Boolean(settled && settled[0] && settled[1]);
}

/** Test-only: drop memoized in-flight extractions between cases. */
export function resetSurfaceFirstTouch(): void {
  inFlight.clear();
}
