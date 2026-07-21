/**
 * Assemble compat members for a set of package names: the fast path reads
 * metadata straight from the DB in one query; any name not tracked is fetched
 * on-demand (the HTTP layer caches packuments) so a single untracked package
 * doesn't blind the whole-architecture check. Names that can't be resolved at
 * all are returned as `unverified` rather than guessed.
 *
 * When a pin differs from the indexed latest, peers/engines are loaded for that
 * exact published version so Tier-1 checks match the stack being installed.
 */
import type { Database } from '../db/client';
import { getCompatMetadata } from '../db/compat';
import { fetchNpmCompatAtVersion, fetchNpmRegistry } from '../ingestion/sources';
import type { CompatMember } from './peerCompat';

export interface CompatPackageRef {
  name: string;
  /** Exact version to check. Null/undefined → indexed latest (or registry latest). */
  version?: string | null;
}

export async function assembleMembers(
  db: Database,
  refs: CompatPackageRef[] | string[],
): Promise<{ members: CompatMember[]; unverified: string[] }> {
  const normalized: CompatPackageRef[] = refs.map((r) =>
    typeof r === 'string' ? { name: r, version: null } : r,
  );
  const names = [...new Set(normalized.map((r) => r.name))];
  const tracked = new Map((await getCompatMetadata(db, names)).map((r) => [r.name, r]));
  const members: CompatMember[] = [];
  const unverified: string[] = [];

  await Promise.all(
    normalized.map(async (ref) => {
      const row = tracked.get(ref.name);
      const pin = ref.version?.trim() || null;
      const canUseIndexed =
        row && (!pin || !row.latestVersion || pin === row.latestVersion);

      if (canUseIndexed && row) {
        members.push({
          name: ref.name,
          version: pin ?? row.latestVersion,
          peerDependencies: row.peerDependencies,
          peerDependenciesMeta: row.peerDependenciesMeta,
          engines: row.engines,
        });
        return;
      }

      // Pinned away from latest (or untracked): load that version's manifest.
      if (pin) {
        const at = await fetchNpmCompatAtVersion(ref.name, pin).catch(() => null);
        if (at) {
          members.push({
            name: ref.name,
            version: at.version,
            peerDependencies: at.peerDependencies,
            peerDependenciesMeta: at.peerDependenciesMeta,
            engines: at.engines,
          });
          return;
        }
        unverified.push(ref.name);
        return;
      }

      const reg = await fetchNpmRegistry(ref.name).catch(() => null);
      if (reg) {
        members.push({
          name: ref.name,
          version: reg.latestVersion,
          peerDependencies: reg.peerDependencies,
          peerDependenciesMeta: reg.peerDependenciesMeta,
          engines: reg.engines,
        });
      } else {
        unverified.push(ref.name);
      }
    }),
  );

  return { members, unverified };
}
