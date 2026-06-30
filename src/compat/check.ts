/**
 * Whole-architecture compatibility check for a set of packages, shared by the
 * `compat` tool and `plan`. Tier 1 (peer-deps/engines, instant) + any recorded
 * Tier-2 sandbox conflicts. The result lists every member as name@version so
 * versions are explicit and the evidence stays structured for later scraping.
 */
import type { CompatConflict, CompatOutput } from '../core/types';
import type { Database } from '../db/client';
import { getCompatEdges } from '../db/compat';
import { assembleMembers } from './members';
import { resolveArchitectureCompat } from './peerCompat';

export async function checkCompat(db: Database, packages: string[]): Promise<CompatOutput> {
  const names = [...new Set(packages)];
  const { members, unverified } = await assembleMembers(db, names);

  const conflicts: CompatConflict[] = resolveArchitectureCompat(members);
  for (const edge of await getCompatEdges(db, names)) {
    if (edge.status === 'conflict') {
      conflicts.push({
        source: 'sandbox',
        packages: [edge.packageA, edge.packageB],
        detail: `${edge.packageA}@${edge.versionA} and ${edge.packageB}@${edge.versionB} failed to co-install in the sandbox`,
      });
    }
  }

  const overall = conflicts.length ? 'conflict' : unverified.length ? 'unknown' : 'compatible';
  return {
    packages: names,
    overall,
    conflicts,
    unverified,
    checked: members.map((m) => ({ name: m.name, version: m.version })),
  };
}
