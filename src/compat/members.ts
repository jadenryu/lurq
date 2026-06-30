/**
 * Assemble compat members for a set of package names: the fast path reads
 * metadata straight from the DB in one query; any name not tracked is fetched
 * on-demand (the HTTP layer caches packuments) so a single untracked package
 * doesn't blind the whole-architecture check. Names that can't be resolved at
 * all are returned as `unverified` rather than guessed.
 */
import type { Database } from '../db/client';
import { getCompatMetadata } from '../db/compat';
import { fetchNpmRegistry } from '../ingestion/sources';
import type { CompatMember } from './peerCompat';

export async function assembleMembers(
  db: Database,
  names: string[],
): Promise<{ members: CompatMember[]; unverified: string[] }> {
  const tracked = new Map((await getCompatMetadata(db, names)).map((r) => [r.name, r]));
  const members: CompatMember[] = [];
  const unverified: string[] = [];

  await Promise.all(
    names.map(async (name) => {
      const row = tracked.get(name);
      if (row) {
        members.push({
          name,
          version: row.latestVersion,
          peerDependencies: row.peerDependencies,
          peerDependenciesMeta: row.peerDependenciesMeta,
          engines: row.engines,
        });
        return;
      }
      const reg = await fetchNpmRegistry(name).catch(() => null);
      if (reg) {
        members.push({
          name,
          version: reg.latestVersion,
          peerDependencies: reg.peerDependencies,
          peerDependenciesMeta: reg.peerDependenciesMeta,
          engines: reg.engines,
        });
      } else {
        unverified.push(name);
      }
    }),
  );

  return { members, unverified };
}
