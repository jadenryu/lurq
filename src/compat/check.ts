/**
 * Whole-architecture compatibility check for a set of packages, shared by the
 * `compat` tool and `plan`. Tier 1 (peer-deps/engines, instant) + any recorded
 * Tier-2 sandbox conflicts. The result lists every member as name@version so
 * versions are explicit and the evidence stays structured for later scraping.
 */
import type { CompatConflict, CompatEvidence, CompatOutput, CompatPair } from '../core/types';
import type { Database } from '../db/client';
import { enqueueCompatVerify, fullyCovered, getCompatEdges, pairKey } from '../db/compat';
import { assembleMembers, type CompatPackageRef } from './members';
import { resolveArchitectureCompat, resolveRuntimeEngineConflicts } from './peerCompat';

/**
 * Evidence-graded verdict (pure). `compatible` requires *positive* proof for every
 * pair; absence of a declared conflict is not proof, so an unverified set is
 * `likely`, never `compatible`. A single package has no pairs → trivially fine.
 */
export function gradeOverall(args: {
  hasConflict: boolean;
  hasUnverifiedMember: boolean;
  memberNames: string[];
  provenCompatible: Set<string>;
}): CompatOutput['overall'] {
  if (args.hasConflict) return 'conflict';
  if (args.hasUnverifiedMember) return 'unknown';
  if (args.memberNames.length < 2 || fullyCovered(args.memberNames, args.provenCompatible))
    return 'compatible';
  return 'likely';
}

export interface CheckCompatOptions {
  /** Exact versions to evaluate (name → version). Missing names use indexed latest. */
  versions?: Record<string, string | null | undefined>;
  /** Target Node runtime (e.g. "20" or "20.20.2"). Checks each package's engines.node. */
  node?: string | null;
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

  const conflicts: CompatConflict[] = [
    ...resolveArchitectureCompat(members),
    ...(opts.node ? resolveRuntimeEngineConflicts(members, opts.node) : []),
  ];
  const edges = await getCompatEdges(db, names);
  const evidence: CompatEvidence[] = edges.map((edge) => ({
    packages: [edge.packageA, edge.packageB],
    versions: [edge.versionA, edge.versionB],
    status: edge.status,
    provenance: edge.provenance,
    witnessCount: edge.witnessCount,
  }));
  // What each member is actually being checked AT. A recorded edge is evidence
  // about the exact two versions it co-installed, and nothing else.
  const versionOf = new Map(members.map((m) => [m.name, m.version]));

  const matchesCheckedVersions = (edge: (typeof edges)[number]): boolean =>
    edgeMatchesVersions(edge, versionOf);

  for (const edge of edges) {
    if (edge.status === 'conflict') {
      // Reported whether or not the versions match. A failed co-install at
      // neighbouring versions is still the best information anyone has about
      // this pair, and the detail names the exact versions so a reader can see
      // it is not the pair they asked about. Suppressing it would be optimism.
      const at = matchesCheckedVersions(edge)
        ? ''
        : ` (recorded at those versions; you are checking ${edge.packageA}@${versionOf.get(edge.packageA) ?? '?'} and ${edge.packageB}@${versionOf.get(edge.packageB) ?? '?'})`;
      conflicts.push({
        source: 'sandbox',
        packages: [edge.packageA, edge.packageB],
        detail: `${edge.packageA}@${edge.versionA} and ${edge.packageB}@${edge.versionB} failed to co-install in the sandbox${at}`,
      });
    }
  }

  // Pairs backed by a *positive* (compatible) edge — verified or observed, AND
  // recorded at the versions under check.
  //
  // Version-matching is what makes `overall: compatible` mean what it says.
  // Execution-verified compatibility is the whole differentiator here, and a
  // name-level match let an edge proving react@18 + next@14 co-install stand as
  // proof for react@19 + next@16 — precisely the major-boundary pair where it is
  // most likely to be false. An unmatched pair now falls through to the
  // self-heal queue below and gets a real answer on the next ask, which is the
  // behaviour an uncovered pair should have had all along.
  const checkedNames = members.map((m) => m.name);
  const provenCompatible = new Set(
    edges
      .filter((e) => e.status === 'compatible' && matchesCheckedVersions(e))
      .map((e) => pairKey(e.packageA, e.packageB)),
  );

  // Self-heal (§4C): if any pair among the checked members lacks a positive edge,
  // queue a background sandbox co-install so the next asker gets a real answer.
  // One deduped insert — never blocks, never runs a VM here. Skip when a conflict
  // is already known (nothing to learn) or every pair is already proven.
  if (checkedNames.length >= 2 && !conflicts.length && !fullyCovered(checkedNames, provenCompatible)) {
    await enqueueCompatVerify(db, checkedNames).catch(() => {});
  }

  const overall = gradeOverall({
    hasConflict: conflicts.length > 0,
    hasUnverifiedMember: unverified.length > 0,
    memberNames: checkedNames,
    provenCompatible,
  });

  return {
    packages: names,
    overall,
    conflicts,
    unverified,
    checked: members.map((m) => ({ name: m.name, version: m.version })),
    evidence,
    pairs: enumeratePairs(checkedNames, conflicts),
  };
}

/**
 * Does a recorded compat edge describe the versions currently under check?
 *
 * A member with no resolved version cannot match anything: treating it as a
 * match would claim an edge is about a version we could not even name. Same
 * discipline as `unverified` everywhere else — not knowing is never evidence.
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
 * `held` is the absence of a violated declared constraint, which is a weaker
 * claim than "these work together" — see the note on CompatPair. It is reported
 * anyway because "we compared these ten pairs and two failed" is a different and
 * more useful statement than "two things failed", and a caller can only make the
 * first one if it knows what the denominator was.
 */
export function enumeratePairs(names: string[], conflicts: CompatConflict[]): CompatPair[] {
  // First conflict wins a pair; a second one for the same two packages adds no
  // verdict, and the detail of the first is the one that was found first.
  const byPair = new Map<string, CompatConflict>();
  for (const c of conflicts) {
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
