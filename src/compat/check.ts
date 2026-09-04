/**
 * Whole-architecture compatibility check for a set of packages, shared by the
 * `compat` tool and `plan`.
 *
 * **The verdict is about the set, not its pairs.** npm resolves a whole
 * dependency graph at once, and three packages can be compatible in every pair
 * and still fail together — a diamond dependency, or a peer range that only
 * becomes unsatisfiable with all three present. The old pairwise model could not
 * express the conflicts npm actually reports, so it could only ever say "no pair
 * is known to be broken", which is what `likely` meant. That verdict is gone: a
 * caller now gets `compatible`, `conflict`, or an honest `unknown`.
 *
 * Three tiers, cheapest first, and the expensive one only runs when the cheap
 * ones are clean:
 *
 *   1. **Declared** (free) — peer ranges and engines off metadata already in the
 *      index. A conflict here needs no network at all.
 *   2. **Cached resolution** (~1ms) — this exact set of `name@version` has been
 *      resolved before, and the answer is immutable for those versions.
 *   3. **Live resolve** (~3-9s warm) — `npm install --package-lock-only`. Real
 *      answer about the real versions, cached on the way out.
 */
import type {
  CompatConflict,
  CompatEvidence,
  CompatOutput,
  CompatPair,
  CompatResolution,
} from '../core/types';
import type { Database } from '../db/client';
import { enqueueCompatVerify, getSandboxEdges, pairKey } from '../db/compat';
import {
  getStackResolution,
  recordStackResolution,
  stackKey,
  type StackMember,
} from '../db/stackResolutions';
import { logger } from '../core/logger';
import { resolveSet } from '../pipeline/resolveCheck';
import { assembleMembers, type CompatPackageRef } from './members';
import { resolveArchitectureCompat, resolveRuntimeEngineConflicts } from './peerCompat';

/**
 * Final verdict (pure). Three outcomes, all of them answers:
 *
 *   - `conflict`   — proven broken, by a declared range, a sandbox co-install,
 *                    or npm's own ERESOLVE.
 *   - `compatible` — npm resolved this exact set of versions.
 *   - `unknown`    — we could not determine it: a member we have no version for,
 *                    or a resolve that timed out. Never a hedge on a set we did
 *                    successfully resolve.
 */
export function gradeOverall(args: {
  hasConflict: boolean;
  hasUnverifiedMember: boolean;
  resolution: 'resolved' | 'conflict' | 'inconclusive';
}): CompatOutput['overall'] {
  if (args.hasConflict || args.resolution === 'conflict') return 'conflict';
  if (args.hasUnverifiedMember || args.resolution === 'inconclusive') return 'unknown';
  return 'compatible';
}

export interface CheckCompatOptions {
  /** Exact versions to evaluate (name → version). Missing names use indexed latest. */
  versions?: Record<string, string | null | undefined>;
  /** Target Node runtime (e.g. "20" or "20.20.2"). Checks each package's engines.node. */
  node?: string | null;
  /** Skip the live resolve on a cache miss — cached answers only. `plan` uses
   *  this: it checks many candidate sets and must not fire an npm process per
   *  candidate. A miss there is `unknown`, which is the honest answer. */
  cachedOnly?: boolean;
}

export async function checkCompat(
  db: Database,
  packages: string[],
  opts: CheckCompatOptions = {},
): Promise<CompatOutput> {
  const names = [...new Set(packages)];
  const refs: CompatPackageRef[] = names.map((name) => ({
    name,
    version: opts.versions?.[name] ?? null,
  }));
  const { members, unverified } = await assembleMembers(db, refs);

  // ── Tier 1: declared constraints. Free, and it short-circuits the rest. ────
  const conflicts: CompatConflict[] = [
    ...resolveArchitectureCompat(members),
    ...(opts.node ? resolveRuntimeEngineConflicts(members, opts.node) : []),
  ];

  // Sandbox verdicts are the one pairwise thing that survives: a real co-install
  // under VM isolation is not derivable from any resolution.
  const edges = await getSandboxEdges(db, names);
  const versionOf = new Map(members.map((m) => [m.name, m.version]));
  const evidence: CompatEvidence[] = edges.map((edge) => ({
    packages: [edge.packageA, edge.packageB],
    versions: [edge.versionA, edge.versionB],
    status: edge.status,
    provenance: edge.provenance,
    witnessCount: edge.witnessCount,
  }));

  for (const edge of edges) {
    if (edge.status !== 'conflict') continue;
    // Reported whether or not the versions match. A failed co-install at
    // neighbouring versions is still the best information anyone has about this
    // pair, and the detail names the exact versions so a reader can see it is
    // not the pair they asked about. Suppressing it would be optimism.
    const at = edgeMatchesVersions(edge, versionOf)
      ? ''
      : ` (recorded at those versions; you are checking ${edge.packageA}@${versionOf.get(edge.packageA) ?? '?'} and ${edge.packageB}@${versionOf.get(edge.packageB) ?? '?'})`;
    conflicts.push({
      source: 'sandbox',
      packages: [edge.packageA, edge.packageB],
      detail: `${edge.packageA}@${edge.versionA} and ${edge.packageB}@${edge.versionB} failed to co-install in the sandbox${at}`,
    });
  }

  const checkedNames = members.map((m) => m.name);
  const { resolution, verdict } = await settle(db, members, {
    // A declared conflict is already proof. Paying npm to re-confirm it would be
    // seconds spent learning nothing.
    skip: conflicts.length > 0,
    cachedOnly: opts.cachedOnly === true,
    hasUnverified: unverified.length > 0,
  });

  if (resolution?.reason === 'ERESOLVE') {
    conflicts.push({
      source: 'resolve',
      packages: checkedNames,
      detail: resolution.detail ?? 'npm could not resolve this set together',
    });
  }

  return {
    packages: names,
    overall: gradeOverall({
      hasConflict: conflicts.length > 0,
      hasUnverifiedMember: unverified.length > 0,
      resolution: verdict,
    }),
    conflicts,
    unverified,
    checked: members.map((m) => ({ name: m.name, version: m.version })),
    evidence,
    ...(resolution ? { resolution } : {}),
    pairs: enumeratePairs(checkedNames, conflicts),
  };
}

/**
 * Get a resolution for this exact set: from cache, or by running npm.
 *
 * Only definitive outcomes are cached. A timeout or a network failure is
 * inconclusive, and writing one down would turn a transient blip into a
 * permanent wrong answer for that stack with nothing to evict it.
 */
async function settle(
  db: Database,
  members: { name: string; version: string | null }[],
  opts: { skip: boolean; cachedOnly: boolean; hasUnverified: boolean },
): Promise<{ resolution: CompatResolution | null; verdict: 'resolved' | 'conflict' | 'inconclusive' }> {
  if (opts.skip) return { resolution: null, verdict: 'inconclusive' };

  // A member with no resolved version cannot be part of a cache key — the key is
  // the exact versions, and "we don't know" is not a version. Same discipline as
  // `unverified` everywhere else: not knowing is never evidence.
  const pinned: StackMember[] = [];
  for (const m of members) {
    if (!m.version) return { resolution: null, verdict: 'inconclusive' };
    pinned.push({ name: m.name, version: m.version });
  }
  if (pinned.length < 2) return { resolution: null, verdict: 'resolved' };

  const key = stackKey(pinned);
  const cached = await getStackResolution(db, key).catch(() => null);
  if (cached) {
    return {
      resolution: {
        source: 'cache',
        resolved: cached.resolved,
        reason: cached.reason === 'ERESOLVE' ? 'ERESOLVE' : null,
        ...(cached.detail ? { detail: cached.detail } : {}),
        at: cached.resolvedAt.toISOString(),
      },
      verdict: cached.resolved ? 'resolved' : 'conflict',
    };
  }
  if (opts.cachedOnly) return { resolution: null, verdict: 'inconclusive' };

  let result;
  try {
    result = await resolveSet(pinned);
  } catch (err) {
    // Network, timeout, npm blew up — inconclusive, and deliberately not cached.
    logger.warn(`compat: resolve inconclusive for ${key}: ${String(err)}`);
    return { resolution: null, verdict: 'inconclusive' };
  }

  await recordStackResolution(db, {
    members: pinned,
    resolved: result.resolved,
    reason: result.reason,
    detail: result.detail ?? null,
  }).catch((err) => logger.warn(`compat: caching resolution failed: ${String(err)}`));

  // A set that resolves is proven to *install*. Whether it actually *runs* is a
  // stronger claim that only the sandbox can make, so escalate it there —
  // deduped on the set key, never blocking, and only on a fresh resolve so a
  // cache hit does not re-queue work already pending.
  if (result.resolved) {
    await enqueueCompatVerify(
      db,
      pinned.map((m) => m.name),
    ).catch(() => {});
  }

  return {
    resolution: {
      source: 'resolved',
      resolved: result.resolved,
      reason: result.reason,
      ...(result.detail ? { detail: result.detail } : {}),
      at: new Date().toISOString(),
    },
    verdict: result.resolved ? 'resolved' : 'conflict',
  };
}

/**
 * Does a recorded sandbox edge describe the versions currently under check?
 *
 * A member with no resolved version cannot match anything: treating it as a
 * match would claim an edge is about a version we could not even name.
 */
export function edgeMatchesVersions(
  edge: { packageA: string; packageB: string; versionA: string; versionB: string },
  versionOf: Map<string, string | null>,
): boolean {
  const a = versionOf.get(edge.packageA);
  const b = versionOf.get(edge.packageB);
  return a != null && b != null && a === edge.versionA && b === edge.versionB;
}

/**
 * Every unordered pair among the checked members, in reading order (row-major
 * over the lower triangle), each graded from the conflicts already found.
 *
 * `held` is the absence of a *found* conflict, which is weaker than "these work
 * together" — the set-level verdict is where positive proof lives. It is
 * reported anyway because "we compared these ten pairs and two failed" is a
 * different and more useful statement than "two things failed", and a caller can
 * only make the first one if it knows what the denominator was.
 */
export function enumeratePairs(names: string[], conflicts: CompatConflict[]): CompatPair[] {
  // First conflict wins a pair; a second one for the same two packages adds no
  // verdict, and the detail of the first is the one that was found first.
  const byPair = new Map<string, CompatConflict>();
  for (const c of conflicts) {
    // A resolve conflict is about the whole set, not one pair — it has no
    // business claiming a specific pair is the broken one.
    if (c.source === 'resolve') continue;
    const [a, b] = c.packages;
    if (!a || !b) continue;
    const key = pairKey(a, b);
    if (!byPair.has(key)) byPair.set(key, c);
  }

  const pairs: CompatPair[] = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = names[i]!;
      const b = names[j]!;
      const hit = byPair.get(pairKey(a, b));
      pairs.push(
        hit
          ? {
              // Orient the pair the way the conflict states it, so `a` is the
              // package making the demand rather than whichever came first in
              // the argument list.
              a: hit.packages[0] ?? a,
              b: hit.packages[1] ?? b,
              status: 'conflict',
              detail: hit.detail,
              ...(hit.requirement ? { requirement: hit.requirement } : {}),
            }
          : { a, b, status: 'held' },
      );
    }
  }
  return pairs;
}
