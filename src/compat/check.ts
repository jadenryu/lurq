/**
 * Whole-architecture compatibility check for a set of packages, shared by the
 * `compat` tool and `plan`. Tier 1 (peer-deps/engines, instant) + any recorded
 * Tier-2 sandbox conflicts. The result lists every member as name@version so
 * versions are explicit and the evidence stays structured for later scraping.
 */
import type { CompatConflict, CompatEvidence, CompatOutput } from '../core/types';
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
  for (const edge of edges) {
    if (edge.status === 'conflict') {
      conflicts.push({
        source: 'sandbox',
        packages: [edge.packageA, edge.packageB],
        detail: `${edge.packageA}@${edge.versionA} and ${edge.packageB}@${edge.versionB} failed to co-install in the sandbox`,
      });
    }
  }

  // Pairs backed by a *positive* (compatible) edge — verified or observed. A
  // `conflict` edge is not positive evidence, so it's excluded here (it already
  // pushed a conflict above). ponytail: name-level coverage; a version-matched
  // check (edge versions == members' current versions) is the stricter follow-up.
  const checkedNames = members.map((m) => m.name);
  const provenCompatible = new Set(
    edges.filter((e) => e.status === 'compatible').map((e) => pairKey(e.packageA, e.packageB)),
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
  };
}
