/**
 * Compatibility verification: co-install a set of packages in the sandbox and
 * record pairwise edges. A successful co-install proves the set coexists (every
 * pair compatible); a 2-package failure proves that pair conflicts. A larger
 * failed set can't pin the culprit, so no edge is asserted (set-level report).
 */
import type { CompatStatus } from '../core/types';
import type { Database } from '../db/client';
import { canonicalPair, upsertCompatEdge } from '../db/compat';
import { getPackageByName } from '../db/packages';
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
