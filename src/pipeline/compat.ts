/**
 * Compatibility verification: co-install a set of packages in the sandbox and
 * record pairwise edges. A successful co-install proves the set coexists (every
 * pair compatible); a 2-package failure proves that pair conflicts. A larger
 * failed set can't pin the culprit, so no edge is asserted (set-level report).
 */
import type { CompatStatus } from '../core/types';
import { logger } from '../core/logger';
import type { Database } from '../db/client';
import { canonicalPair, getCompatEdges, upsertCompatEdge } from '../db/compat';
import { getPackageByName, getTopPackageNames } from '../db/packages';
import { getSandbox } from '../sandbox';
import type { SandboxSetResult } from '../sandbox/types';

export interface CompatEdge {
  a: string;
  aVersion: string;
  b: string;
  bVersion: string;
  status: CompatStatus;
}

interface Resolved {
  name: string;
  version: string;
}

/** Derive pairwise edges from a set co-install result. Pure. */
export function deriveCompatEdges(resolved: Resolved[], result: SandboxSetResult): CompatEdge[] {
  const allLoaded = result.loaded.every((l) => l.loaded === true);
  const edges: CompatEdge[] = [];

  if (result.installed && allLoaded) {
    // Co-install proved the whole set coexists → every pair is compatible.
    for (let i = 0; i < resolved.length; i++) {
      for (let j = i + 1; j < resolved.length; j++) {
        edges.push({
          a: resolved[i]!.name,
          aVersion: resolved[i]!.version,
          b: resolved[j]!.name,
          bVersion: resolved[j]!.version,
          status: 'compatible',
        });
      }
    }
  } else if (resolved.length === 2) {
    // A failed *pair* is precise: those two conflict.
    edges.push({
      a: resolved[0]!.name,
      aVersion: resolved[0]!.version,
      b: resolved[1]!.name,
      bVersion: resolved[1]!.version,
      status: 'conflict',
    });
  }
  // else: a larger set failed — can't attribute the conflict to a single pair.
  return edges;
}

export interface CompatRunResult {
  result: SandboxSetResult;
  edges: CompatEdge[];
  /** A set-level conflict that couldn't be pinned to a specific pair. */
  unattributedConflict: boolean;
}

export async function verifyCompatibility(
  db: Database,
  packages: string[],
  opts: { allowScripts?: boolean } = {},
): Promise<CompatRunResult> {
  const resolved: Resolved[] = await Promise.all(
    packages.map(async (name) => ({
      name,
      version: (await getPackageByName(db, name))?.latestVersion ?? 'latest',
    })),
  );

  const result = await (await getSandbox()).verifySet(
    resolved.map((r) => ({ name: r.name, version: r.version === 'latest' ? null : r.version })),
    { allowScripts: opts.allowScripts },
  );

  const edges = deriveCompatEdges(resolved, result);
  for (const e of edges) {
    const pair = canonicalPair(
      { name: e.a, version: e.aVersion },
      { name: e.b, version: e.bVersion },
    );
    await upsertCompatEdge(db, {
      ...pair,
      status: e.status,
      // Sandbox is the only mechanism that proves a negative; a failed pair is a
      // `conflict`, a passed set is `verified`. Both outrank a mined `observed`.
      provenance: e.status === 'conflict' ? 'conflict' : 'verified',
      witnessCount: 0,
      driver: result.driver,
      ranAt: new Date(),
    }).catch(() => {});
  }

  const failed = !result.installed || !result.loaded.every((l) => l.loaded === true);
  return { result, edges, unattributedConflict: failed && edges.length === 0 };
}

// ── Targeted backfill (§4C) ───────────────────────────────────────────────────

/** Canonical `a|b` key for a name pair, order-independent. */
export function pairKey(a: string, b: string): string {
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

/** Name-pair keys that already have *any* stored edge among `names` — the pairs
 *  a sandbox run would waste itself on (§4C: sandbox is only for unverified). */
async function coveredPairs(db: Database, names: string[]): Promise<Set<string>> {
  const edges = await getCompatEdges(db, names);
  return new Set(edges.map((e) => pairKey(e.packageA, e.packageB)));
}

/** True if every C(K,2) pair in a batch already has an edge — skip the VM run. */
export function fullyCovered(batch: string[], covered: Set<string>): boolean {
  for (let i = 0; i < batch.length; i++) {
    for (let j = i + 1; j < batch.length; j++) {
      if (!covered.has(pairKey(batch[i]!, batch[j]!))) return false;
    }
  }
  return true;
}

export interface BackfillResult {
  batches: number;
  verified: number;
  skipped: number;
}

/**
 * Reserve E2B runs for where they buy the most (§4C): co-install the top-N
 * popular tracked packages in batches, minting `verified` edges for every pair
 * that mining/Tier-0 left `unverified`. One K-package co-install yields all
 * C(K,2) edges (`deriveCompatEdges`), so the per-edge cost is sublinear. Batches
 * already fully covered by existing edges are skipped — no wasted VM time.
 */
export async function backfillVerify(
  db: Database,
  opts: { topN?: number; batchSize?: number } = {},
): Promise<BackfillResult> {
  const topN = opts.topN ?? 50;
  const batchSize = Math.max(2, opts.batchSize ?? 5);
  const names = await getTopPackageNames(db, topN);
  const covered = await coveredPairs(db, names);

  let verified = 0;
  let batches = 0;
  let skipped = 0;
  for (let i = 0; i < names.length; i += batchSize) {
    const batch = names.slice(i, i + batchSize);
    if (batch.length < 2) continue;
    if (fullyCovered(batch, covered)) {
      skipped++;
      continue;
    }
    logger.info(`backfill: co-installing ${batch.join(', ')}`);
    const { edges } = await verifyCompatibility(db, batch).catch((err) => {
      logger.warn(`backfill batch failed (${batch.join(', ')}): ${String(err)}`);
      return { edges: [] as CompatEdge[] };
    });
    verified += edges.length;
    batches++;
  }
  logger.info(`backfill: ${verified} edges across ${batches} runs, ${skipped} batches skipped`);
  return { batches, verified, skipped };
}
