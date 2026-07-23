/** Read/write helpers for the compatibility matrix (`compat_edges`). */
import { and, eq, inArray, sql, type SQLWrapper } from 'drizzle-orm';
import type { DependencyRanges, PeerMeta } from '../core/types';
import type { Database } from './client';
import {
  compatEdges,
  compatVerifyQueue,
  packages,
  resolvedClosures,
  type CompatEdgeRow,
  type CompatVerifyQueueRow,
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

/** Max rows per compat_edges INSERT. Fat closures (10k+ pairs) must not become
 *  one mega-statement — that OOMs Node and trips Postgres param limits. Chunks
 *  lose per-closure atomicity; fine for loss-tolerant `observed` mints. */
export const EDGE_UPSERT_CHUNK = 250;

/** Split `items` into consecutive slices of at most `size`. Exported for tests. */
export function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) throw new Error(`chunk size must be positive, got ${size}`);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Batch-upsert edges (§4F write-behind for high-volume, loss-tolerant `observed`
 * mints). Writes in chunks of {@link EDGE_UPSERT_CHUNK} so large closures stay
 * within Postgres bind limits and Drizzle AST depth. The caller MUST pass a
 * batch with unique conflict keys (Postgres rejects the same ON CONFLICT target
 * twice per statement) — one resolved closure's canonical pairs are unique by
 * construction; each chunk inherits that. Same precedence as the single upsert;
 * verified/conflict/score writes stay individual (durable).
 */
export async function upsertCompatEdgesBatch(db: Database, edges: NewCompatEdgeRow[]): Promise<void> {
  if (edges.length === 0) return;
  for (const part of chunk(edges, EDGE_UPSERT_CHUNK)) {
    await db
      .insert(compatEdges)
      .values(part)
      .onConflictDoUpdate({ target: [...CONFLICT_TARGET], set: conflictSet() });
  }
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

// ── Pure pair helpers (§4C) ──────────────────────────────────────────────────

/** Canonical `a|b` key for a name pair, order-independent. */
export function pairKey(a: string, b: string): string {
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

/** True if every C(K,2) pair in a batch already has an edge in `covered`. */
export function fullyCovered(batch: string[], covered: Set<string>): boolean {
  for (let i = 0; i < batch.length; i++) {
    for (let j = i + 1; j < batch.length; j++) {
      if (!covered.has(pairKey(batch[i]!, batch[j]!))) return false;
    }
  }
  return true;
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
