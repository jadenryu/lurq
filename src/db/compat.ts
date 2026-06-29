/** Read/write helpers for the compatibility matrix (`compat_edges`). */
import { and, inArray } from 'drizzle-orm';
import type { Database } from './client';
import { compatEdges, type CompatEdgeRow, type NewCompatEdgeRow } from './schema';

/** Order a pair canonically by package name so (A,B) and (B,A) dedupe to one row. */
export function canonicalPair(
  a: { name: string; version: string },
  b: { name: string; version: string },
): { packageA: string; versionA: string; packageB: string; versionB: string } {
  const [low, high] = a.name <= b.name ? [a, b] : [b, a];
  return { packageA: low.name, versionA: low.version, packageB: high.name, versionB: high.version };
}

export async function upsertCompatEdge(db: Database, edge: NewCompatEdgeRow): Promise<void> {
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
      set: { status: edge.status, driver: edge.driver, ranAt: edge.ranAt },
    });
}

/** All stored edges whose both endpoints are within the given package names. */
export async function getCompatEdges(db: Database, names: string[]): Promise<CompatEdgeRow[]> {
  if (names.length === 0) return [];
  return db
    .select()
    .from(compatEdges)
    .where(and(inArray(compatEdges.packageA, names), inArray(compatEdges.packageB, names)));
}
