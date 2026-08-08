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
import { getAllPackageNames } from '../db/packages';
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
 */
export function trackedPairs(
  nodes: ResolvedNode[],
  tracked: Set<string>,
): ReturnType<typeof canonicalPair>[] {
  const t = nodes.filter((n) => tracked.has(n.name));
  const pairs: ReturnType<typeof canonicalPair>[] = [];
  for (let i = 0; i < t.length; i++) {
    for (let j = i + 1; j < t.length; j++) {
      // Skip two versions of the same package co-resolving — not a compat claim.
      if (t[i]!.name === t[j]!.name) continue;
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
): Promise<number> {
  const pairs = trackedPairs(nodes, tracked);
  const rows = pairs.map((pair) => ({
    ...pair,
    status: 'compatible' as const,
    provenance: 'observed' as const,
    witnessCount: 1,
    driver: 'depsdev',
    ranAt: now,
  }));
  await (freshWitness
    ? upsertCompatEdgesBatch(db, rows)
    : upsertObservedEdgesRemine(db, rows));
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

/**
 * Trigger 2 — daily re-mine pass (§4B). Opportunistic minting alone misses a
 * stable package P that never republishes: a package tracked *later* would never
 * link to it. This local pass re-scans every persisted closure against the
 * *current* tracked set — no network — so any package is fully linked within 24h
 * of becoming tracked.
 *
 * Its only real output is edges that did not exist yet: it is re-reading closures
 * it has already mined, so an already-known pair gets no witness and no `ran_at`
 * bump ({@link upsertObservedEdgesRemine}). Pair *generation* is still
 * O(tracked-in-closure²) — ~4.5M candidate rows a pass — but all but the genuinely
 * new ones are now discarded by Postgres without a write.
 */
export async function remineAllClosures(db: Database): Promise<number> {
  const tracked = new Set(await getAllPackageNames(db));
  const closures = await getAllClosures(db);
  const now = new Date();
  let count = 0;
  for (const c of closures) {
    count += await mintObservedPairs(db, c.nodes, tracked, now, false);
  }
  logger.info(`re-mine: ${count} candidate pairs across ${closures.length} closures`);
  return count;
}
