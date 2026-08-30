/**
 * Compat edge miner (§4B — the moat). A resolved dependency graph is a
 * co-installation witness: npm's resolver found a working assignment including
 * every node and the artifact shipped, so every pair inside provably co-resolves.
 * We fetch these graphs anyway; the miner is pure transformation — free,
 * evidence-backed `observed` edges.
 *
 * Bounded to **tracked × tracked** pairs (§4B step 2): a resolved closure has
 * hundreds of transitive nodes (`ms`↔`bytes` plumbing nobody queries); C(N,2)
 * explodes. Mining only pairs where both endpoints are tracked keeps writes to
 * ~C(tracked-in-tree, 2) and to the universe we actually serve queries about.
 */
import { formatError } from '../core/errors';
import { logger } from '../core/logger';
import { getAllPackageNames, getPackageNamesCreatedSince } from '../db/packages';
import { getWatchCursor, setWatchCursor } from '../db/watch';
import {
  canonicalPair,
  getAllClosures,
  persistClosure,
  upsertCompatEdgesBatch,
  upsertObservedEdgesRemine,
} from '../db/compat';
import type { Database } from '../db/client';
import { fetchResolvedGraph, type ResolvedNode } from '../ingestion/sources/depsDev';

/**
 * Canonical tracked×tracked pairs in a closure (§4B step 2). Pure — the bounded
 * pair set, filtered to the served universe, same-package pairs dropped. Exported
 * for the self-check; the explosion guard lives entirely here.
 *
 * `mustTouch` narrows it further: emit only pairs with at least one endpoint in
 * that set. The re-mine pass (trigger 2) uses it because a pair of two packages
 * that were *both* already tracked when this closure was last walked has already
 * been minted — regenerating it just to have Postgres reject the insert is the
 * bulk of the pass's cost and produces nothing. Omitted, every pair is emitted.
 */
export function trackedPairs(
  nodes: ResolvedNode[],
  tracked: Set<string>,
  mustTouch?: Set<string>,
): ReturnType<typeof canonicalPair>[] {
  const t = nodes.filter((n) => tracked.has(n.name));
  const pairs: ReturnType<typeof canonicalPair>[] = [];
  for (let i = 0; i < t.length; i++) {
    for (let j = i + 1; j < t.length; j++) {
      // Skip two versions of the same package co-resolving — not a compat claim.
      if (t[i]!.name === t[j]!.name) continue;
      if (mustTouch && !mustTouch.has(t[i]!.name) && !mustTouch.has(t[j]!.name)) continue;
      pairs.push(canonicalPair(t[i]!, t[j]!));
    }
  }
  return pairs;
}

/**
 * Mint `observed` edges for every tracked-tracked pair in a resolved closure.
 * One chunked batch upsert per closure (§4F) — pairs are unique within a closure;
 * both writers split large sets so fat trees stay bounded.
 *
 * `freshWitness` distinguishes the two triggers. Trigger 1 has a closure it just
 * fetched, which is a new co-installation witness, so it accrues. Trigger 2
 * re-reads closures it has already mined and must not re-count them — see
 * {@link upsertObservedEdgesRemine}.
 */
async function mintObservedPairs(
  db: Database,
  nodes: ResolvedNode[],
  tracked: Set<string>,
  now: Date,
  freshWitness: boolean,
  mustTouch?: Set<string>,
): Promise<number> {
  const pairs = trackedPairs(nodes, tracked, mustTouch);
  if (pairs.length === 0) return 0;
  const rows = pairs.map((pair) => ({
    ...pair,
    status: 'compatible' as const,
    provenance: 'observed' as const,
    witnessCount: 1,
    driver: 'depsdev',
    ranAt: now,
  }));
  await (freshWitness ? upsertCompatEdgesBatch(db, rows) : upsertObservedEdgesRemine(db, rows));
  return pairs.length;
}

/**
 * Trigger 1 — mint at ingest (§4B). Fetch `name@version`'s resolved closure,
 * persist it immutably (so the daily re-mine can read it with no network), and
 * mint `observed` edges among the nodes that are *already* tracked. Best-effort:
 * a mining failure never fails the ingest that called it.
 *
 * `tracked` may be preloaded once per bulk sync; omitted, it's loaded here (one
 * query) for the on-demand single-package path.
 */
export async function mineEdgesForPackage(
  db: Database,
  name: string,
  version: string | null,
  tracked?: Set<string>,
  now: Date = new Date(),
): Promise<number> {
  if (!version) return 0;
  try {
    const closure = await fetchResolvedGraph(name, version);
    if (closure.length === 0) return 0;
    await persistClosure(db, name, version, closure).catch(() => {});
    const set = tracked ?? new Set(await getAllPackageNames(db));
    // Freshly fetched closure — a genuinely new witness, so it accrues.
    return await mintObservedPairs(db, closure, set, now, true);
  } catch (err) {
    logger.warn(`edge mining failed for ${name}@${version}: ${formatError(err)}`);
    return 0;
  }
}

/** Cursor row (`watch_state`) holding when the re-mine pass last completed. */
const REMINE_CURSOR_ID = 'remine-last-run';

/**
 * Trigger 2 — daily re-mine pass (§4B). Opportunistic minting alone misses a
 * stable package P that never republishes: a package tracked *later* would never
 * link to it. This local pass re-scans persisted closures against the *current*
 * tracked set — no network — so any package is fully linked within 24h of
 * becoming tracked.
 *
 * **Incremental.** The pass can only produce an edge that touches a package which
 * became tracked since it last ran; a pair of two already-tracked packages was
 * minted the last time round. So it asks for exactly those names and walks only
 * the closures containing one, emitting only the pairs touching one.
 *
 * It used to walk all ~21.6k closures and regenerate every pair — ~4.5M candidate
 * rows a pass, of which essentially all were rejected by the unique index. Twice
 * a day (a duplicate cron tile), that is most of how `compat_edges` reached
 * 187.9M updates and burned 1.02B sequence values to hold 11.5M rows, every
 * rejected insert probing a 1.4GB index through a 233MB buffer pool. The output
 * was the same either way: the new edges.
 *
 * With no cursor stored it falls back to a full pass, which is also what you want
 * the first time it runs after this change.
 */
export async function remineAllClosures(db: Database): Promise<number> {
  // Stamped from *before* the work, so packages that arrive mid-pass are caught
  // next time rather than skipped. Re-processing a few is idempotent.
  const startedAt = new Date();
  const cursor = await getWatchCursor(db, REMINE_CURSOR_ID);
  const since = cursor ? new Date(cursor) : null;
  const full = since === null || Number.isNaN(since.getTime());

  const tracked = new Set(await getAllPackageNames(db));
  const newlyTracked = full ? null : new Set(await getPackageNamesCreatedSince(db, since!));

  if (newlyTracked && newlyTracked.size === 0) {
    logger.info('re-mine: no packages became tracked since the last pass, nothing to link.');
    await setWatchCursor(db, REMINE_CURSOR_ID, startedAt.toISOString());
    return 0;
  }

  const closures = await getAllClosures(db);
  // A closure can only yield a new edge if it actually contains a new name.
  const relevant = newlyTracked
    ? closures.filter((c) => c.nodes.some((n) => newlyTracked.has(n.name)))
    : closures;

  let count = 0;
  for (const c of relevant) {
    count += await mintObservedPairs(
      db,
      c.nodes,
      tracked,
      startedAt,
      false,
      newlyTracked ?? undefined,
    );
  }

  await setWatchCursor(db, REMINE_CURSOR_ID, startedAt.toISOString());
  logger.info(
    full
      ? `re-mine (full): ${count} candidate pairs across ${closures.length} closures`
      : `re-mine: ${count} candidate pairs across ${relevant.length}/${closures.length} closures ` +
          `for ${newlyTracked!.size} newly-tracked package(s)`,
  );
  return count;
}
