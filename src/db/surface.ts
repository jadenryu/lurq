/**
 * Surface persistence (§5, §6.5).
 *
 * Two responsibilities:
 *   1. Store an extracted surface as `symbols` + an `observation` recording how
 *      it was established (class + tier), never overwriting history.
 *   2. Skip re-extraction when the artifact digest is unchanged — the content-
 *      addressed cache that keeps cost sublinear as the index grows.
 *
 * Nothing here executes package code; extraction upstream is static (§9.2).
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from './client';
import { entities, surfaceQueue, symbols } from './schema';
import type { SurfaceQueueRow } from './schema';
import { recordObservation, upsertClaim, upsertEntity } from './graph';
import type { EntityRef } from '../graph/types';
import type { ExtractedSurface, ExtractionTier } from '../surface/types';

/** The entity ref for a package version's surface. */
export function surfaceRef(pkg: string, version: string | null): EntityRef {
  return { kind: 'package_surface', namespace: 'npm', name: pkg, version };
}

/**
 * Has this exact artifact already been extracted? The digest is the cache key,
 * so an unchanged tarball never pays for extraction twice (§6.5).
 */
export async function isExtractionCached(
  db: Database,
  ref: EntityRef,
  artifactHash: string,
  tier: ExtractionTier = 'shipped_js_ast',
  tenantId = 0,
): Promise<boolean> {
  const row = await upsertEntity(db, ref, tenantId);
  if (row.artifactHash !== artifactHash) return false;
  const existing = await db
    .select({ id: symbols.id })
    .from(symbols)
    .where(and(eq(symbols.entityId, row.id), eq(symbols.tier, tier)))
    .limit(1);
  return existing.length > 0;
}

/**
 * Persist an extracted surface.
 *
 * An empty surface is recorded as `undeclared` with the extractor's stated
 * reason — never as "this package exports nothing" (§4.2, §6.4.2). That
 * distinction is the difference between a measurement gap and a false removal.
 */
export async function storeSurface(
  db: Database,
  surface: ExtractedSurface,
  opts: { artifactHash?: string | null; extractorVersion: string; tenantId?: number } = {
    extractorVersion: '1',
  },
): Promise<{ entityId: number; symbolsWritten: number; verdict: string }> {
  const tenantId = opts.tenantId ?? 0;
  const ref = surfaceRef(surface.package, surface.version);
  const entity = await upsertEntity(db, ref, tenantId);

  if (opts.artifactHash) {
    await db
      .update(entities)
      .set({ artifactHash: opts.artifactHash })
      .where(eq(entities.id, entity.id));
  }

  const claim = await upsertClaim(db, {
    subjectId: entity.id,
    relation: 'exposes',
    // Declared claims are environment-independent: a shipped-JS surface reads
    // identically on every machine, so no fingerprint is attached (§5).
    environmentId: null,
    tenantId,
  });

  const undeclared = surface.symbols.length === 0;
  await recordObservation(db, {
    claimId: claim.id,
    verdict: undeclared ? 'undeclared' : 'verified_true',
    class: 'declared',
    tier: surface.tier,
    evidence: undeclared
      ? (surface.undeclaredReason ?? 'no symbols extracted')
      : `${surface.symbols.length} symbols from ${surface.filesWalked} file(s), entry ${surface.entry}`,
    oracleId: 'surface.tier_a',
    oracleVer: opts.extractorVersion,
  });

  if (undeclared) return { entityId: entity.id, symbolsWritten: 0, verdict: 'undeclared' };

  // Replace only THIS tier's rows: a tier-C surface must never clear the tier-A
  // one, since they answer different questions (§6.4.3). Symbols snapshot an
  // immutable artifact; the history that matters lives in `observations`.
  await db
    .delete(symbols)
    .where(and(eq(symbols.entityId, entity.id), eq(symbols.tier, surface.tier)));
  const rows = surface.symbols.map((s) => ({
    entityId: entity.id,
    path: s.path,
    kind: s.kind,
    arity: s.arity,
    origin: s.origin,
    deprecated: s.deprecated,
    tier: s.tier,
    signature: s.signature ?? null,
    sourceFile: s.sourceRef?.file ?? null,
    sourceLine: s.sourceRef?.line ?? null,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    await db.insert(symbols).values(rows.slice(i, i + 500)).onConflictDoNothing();
  }

  return { entityId: entity.id, symbolsWritten: rows.length, verdict: 'verified_true' };
}

/** Dedup key for the extraction queue. */
export function specKey(pkg: string, version: string | null): string {
  return `${pkg}@${version ?? 'latest'}`;
}

/**
 * Record a query miss (§6.1). Instant, deduped, and never blocking — the query
 * path returns UNKNOWN and the worker does the work.
 */
export async function enqueueSurface(
  db: Database,
  pkg: string,
  version: string | null,
): Promise<void> {
  await db
    .insert(surfaceQueue)
    .values({ packageName: pkg, version, specKey: specKey(pkg, version) })
    .onConflictDoNothing();
}

/** Oldest pending specs, for the worker drain. */
export async function getPendingSurfaces(db: Database, limit = 10): Promise<SurfaceQueueRow[]> {
  return db.select().from(surfaceQueue).orderBy(surfaceQueue.requestedAt).limit(limit);
}

export async function dropSurfaceQueue(db: Database, id: number): Promise<void> {
  await db.delete(surfaceQueue).where(eq(surfaceQueue.id, id));
}

export async function bumpSurfaceAttempt(db: Database, id: number): Promise<void> {
  await db
    .update(surfaceQueue)
    .set({ attempts: sql`${surfaceQueue.attempts} + 1` })
    .where(eq(surfaceQueue.id, id));
}
