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
import { logger } from '../core/logger';
import { getAllPackageNames } from '../db/packages';
import { canonicalPair, getAllClosures, persistClosure, upsertCompatEdge } from '../db/compat';
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

/** Mint `observed` edges for every tracked-tracked pair in a resolved closure. */
async function mintObservedPairs(
  db: Database,
  nodes: ResolvedNode[],
  tracked: Set<string>,
  now: Date,
): Promise<number> {
  const pairs = trackedPairs(nodes, tracked);
  for (const pair of pairs) {
    await upsertCompatEdge(db, {
      ...pair,
      status: 'compatible',
      provenance: 'observed',
      witnessCount: 1,
      driver: 'depsdev',
      ranAt: now,
    });
  }
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
    return await mintObservedPairs(db, closure, set, now);
  } catch (err) {
    logger.warn(`edge mining failed for ${name}@${version}: ${String(err)}`);
    return 0;
  }
}

/**
 * Trigger 2 — daily re-mine pass (§4B). Opportunistic minting alone misses a
 * stable package P that never republishes: a package tracked *later* would never
 * link to it. This local pass re-scans every persisted closure against the
 * *current* tracked set — no network — so any package is fully linked within 24h
 * of becoming tracked. Idempotent: unchanged pairs no-op (witness still accrues,
 * which is the point). Cost is O(tracked × tracked-in-closure) mostly-noop upserts.
 */
export async function remineAllClosures(db: Database): Promise<number> {
  const tracked = new Set(await getAllPackageNames(db));
  const closures = await getAllClosures(db);
  const now = new Date();
  let count = 0;
  for (const c of closures) {
    count += await mintObservedPairs(db, c.nodes, tracked, now);
  }
  logger.info(`re-mine: ${count} observed edge upserts across ${closures.length} closures`);
  return count;
}
