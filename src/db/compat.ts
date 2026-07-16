/** Read/write helpers for the compatibility matrix (`compat_edges`). */
import { and, inArray, sql, type SQLWrapper } from 'drizzle-orm';
import type { DependencyRanges, PeerMeta } from '../core/types';
import type { Database } from './client';
import {
  compatEdges,
  packages,
  resolvedClosures,
  type CompatEdgeRow,
  type NewCompatEdgeRow,
  type ResolvedClosureRow,
} from './schema';

export interface CompatMetadataRow {
  name: string;
  latestVersion: string | null;
  peerDependencies: DependencyRanges | null;
  peerDependenciesMeta: PeerMeta | null;
  engines: DependencyRanges | null;
}

/** Tier-1 compatibility metadata for a set of packages — one indexed query. */
export async function getCompatMetadata(
  db: Database,
  names: string[],
): Promise<CompatMetadataRow[]> {
  if (names.length === 0) return [];
  return db
    .select({
      name: packages.name,
      latestVersion: packages.latestVersion,
      peerDependencies: packages.peerDependencies,
      peerDependenciesMeta: packages.peerDependenciesMeta,
      engines: packages.engines,
    })
    .from(packages)
    .where(inArray(packages.name, names));
}

/** Order a pair canonically by package name so (A,B) and (B,A) dedupe to one row. */
export function canonicalPair(
  a: { name: string; version: string },
  b: { name: string; version: string },
): { packageA: string; versionA: string; packageB: string; versionB: string } {
  const [low, high] = a.name <= b.name ? [a, b] : [b, a];
  return { packageA: low.name, versionA: low.version, packageB: high.name, versionB: high.version };
}

/** Provenance rank as SQL, mirroring PROVENANCE_RANK (§4B). Higher wins. */
function provenanceRank(col: SQLWrapper) {
  return sql`case ${col} when 'conflict' then 3 when 'verified' then 2 when 'observed' then 1 else 0 end`;
}

/**
 * Upsert a compat edge with provenance precedence (§4B). On conflict:
 *  - witness_count *accumulates* (corroboration must add up, never overwrite);
 *    verified/conflict edges pass 0 so they're unaffected.
 *  - status/provenance/driver/ranAt update only when the incoming edge is at least
 *    as strong as the stored one, so a mined `observed` can never erase a sandbox
 *    `verified`/`conflict`. Encodes conflict > verified > observed > declared.
 */
export async function upsertCompatEdge(db: Database, edge: NewCompatEdgeRow): Promise<void> {
  const incomingWins = sql`${provenanceRank(sql`excluded.provenance`)} >= ${provenanceRank(compatEdges.provenance)}`;
  await db
    .insert(compatEdges)
    .values(edge)
    .onConflictDoUpdate({
      target: [
        compatEdges.packageA,
        compatEdges.versionA,
        compatEdges.packageB,
        compatEdges.versionB,
      ],
      set: {
        status: sql`case when ${incomingWins} then excluded.status else ${compatEdges.status} end`,
        provenance: sql`case when ${incomingWins} then excluded.provenance else ${compatEdges.provenance} end`,
        driver: sql`case when ${incomingWins} then excluded.driver else ${compatEdges.driver} end`,
        ranAt: sql`case when ${incomingWins} then excluded.ran_at else ${compatEdges.ranAt} end`,
        witnessCount: sql`${compatEdges.witnessCount} + excluded.witness_count`,
      },
    });
}

/** Persist a resolved closure once (§4B); refresh nodes if the version reappears
 *  (a republish under the same version — rare, but keep the freshest). */
export async function persistClosure(
  db: Database,
  packageName: string,
  version: string,
  nodes: { name: string; version: string }[],
): Promise<void> {
  await db
    .insert(resolvedClosures)
    .values({ packageName, version, nodes })
    .onConflictDoUpdate({
      target: [resolvedClosures.packageName, resolvedClosures.version],
      set: { nodes, fetchedAt: new Date() },
    });
}

/** All persisted closures — the daily re-mine pass reads these with no network. */
export async function getAllClosures(db: Database): Promise<ResolvedClosureRow[]> {
  return db.select().from(resolvedClosures);
}

/** All stored edges whose both endpoints are within the given package names. */
export async function getCompatEdges(db: Database, names: string[]): Promise<CompatEdgeRow[]> {
  if (names.length === 0) return [];
  return db
    .select()
    .from(compatEdges)
    .where(and(inArray(compatEdges.packageA, names), inArray(compatEdges.packageB, names)));
}
