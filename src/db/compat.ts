/** Read/write helpers for the compatibility matrix (`compat_edges`). */
import { and, eq, inArray, sql, type SQLWrapper } from 'drizzle-orm';
import {
  DEFAULT_ECOSYSTEM,
  type DependencyRanges,
  type Ecosystem,
  type PeerMeta,
} from '../core/types';
import type { Database } from './client';
import {
  compatEdges,
  compatVerifyQueue,
  packages,
  type CompatEdgeRow,
  type CompatVerifyQueueRow,
  type NewCompatEdgeRow,
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
  ecosystem: Ecosystem = DEFAULT_ECOSYSTEM,
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
    .where(and(inArray(packages.name, names), eq(packages.ecosystem, ecosystem)));
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

/** The provenance-precedence conflict SET, shared by single + batch upsert (§4B).
 *  witness_count accumulates; status/provenance/driver/ranAt update only when the
 *  incoming edge is at least as strong, so a mined `observed` never erases a
 *  sandbox `verified`/`conflict`. Encodes conflict > verified > observed > declared. */
function conflictSet() {
  const incomingWins = sql`${provenanceRank(sql`excluded.provenance`)} >= ${provenanceRank(compatEdges.provenance)}`;
  return {
    status: sql`case when ${incomingWins} then excluded.status else ${compatEdges.status} end`,
    provenance: sql`case when ${incomingWins} then excluded.provenance else ${compatEdges.provenance} end`,
    driver: sql`case when ${incomingWins} then excluded.driver else ${compatEdges.driver} end`,
    ranAt: sql`case when ${incomingWins} then excluded.ran_at else ${compatEdges.ranAt} end`,
    witnessCount: sql`${compatEdges.witnessCount} + excluded.witness_count`,
  };
}

const CONFLICT_TARGET = [
  compatEdges.packageA,
  compatEdges.versionA,
  compatEdges.packageB,
  compatEdges.versionB,
] as const;

export async function upsertCompatEdge(db: Database, edge: NewCompatEdgeRow): Promise<void> {
  await db
    .insert(compatEdges)
    .values(edge)
    .onConflictDoUpdate({ target: [...CONFLICT_TARGET], set: conflictSet() });
}

/**
 * Sandbox-established edges only — `verified` and `conflict`.
 *
 * These are the rows that are *not* derivable from anything else: a real
 * co-install that passed or failed under VM isolation. `observed` edges are
 * deliberately excluded, because the set-level resolve now answers the question
 * they were mined to answer, and answers it about the exact versions asked for
 * rather than whatever versions a third party's dependency tree happened to pin.
 *
 * Scoped by name, not by version: a sandbox conflict at neighbouring versions is
 * still the best information anyone has about the pair, and `checkCompat` labels
 * the version mismatch rather than hiding the row.
 */
export async function getSandboxEdges(db: Database, names: string[]): Promise<CompatEdgeRow[]> {
  if (names.length === 0) return [];
  return db
    .select()
    .from(compatEdges)
    .where(
      and(
        inArray(compatEdges.packageA, names),
        inArray(compatEdges.packageB, names),
        inArray(compatEdges.provenance, ['verified', 'conflict']),
      ),
    );
}

// ── Pure pair helpers (§4C) ──────────────────────────────────────────────────

/** Canonical `a|b` key for a name pair, order-independent. */
export function pairKey(a: string, b: string): string {
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

/** Canonical order-independent key for a whole package set (queue dedup). */
export function compatSetKey(names: string[]): string {
  return [...new Set(names)].sort().join('|');
}

// ── Demand-driven compat-verify queue (§4C) ──────────────────────────────────

/** Queue a package set for background sandbox co-install. Deduped on the set key,
 *  so repeated queries for the same unverified set enqueue exactly one run.
 *  Returns true if a new row was inserted. */
export async function enqueueCompatVerify(db: Database, names: string[]): Promise<boolean> {
  const packages = [...new Set(names)].filter(Boolean);
  if (packages.length < 2) return false;
  const inserted = await db
    .insert(compatVerifyQueue)
    .values({ setKey: compatSetKey(packages), packages })
    .onConflictDoNothing({ target: compatVerifyQueue.setKey })
    .returning({ id: compatVerifyQueue.id });
  return inserted.length > 0;
}

/** Oldest-first pending verify requests (FIFO fairness). */
export async function getPendingCompatVerify(
  db: Database,
  limit: number,
): Promise<CompatVerifyQueueRow[]> {
  return db
    .select()
    .from(compatVerifyQueue)
    .orderBy(compatVerifyQueue.requestedAt)
    .limit(limit);
}

export async function deleteCompatVerify(db: Database, id: number): Promise<void> {
  await db.delete(compatVerifyQueue).where(eq(compatVerifyQueue.id, id));
}

/** Bump attempt count; returns the new count so the caller can drop a stuck set. */
export async function bumpCompatVerifyAttempt(db: Database, id: number): Promise<number> {
  const [row] = await db
    .update(compatVerifyQueue)
    .set({ attempts: sql`${compatVerifyQueue.attempts} + 1` })
    .where(eq(compatVerifyQueue.id, id))
    .returning({ attempts: compatVerifyQueue.attempts });
  return row?.attempts ?? 0;
}
