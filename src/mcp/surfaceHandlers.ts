/**
 * `resolve_surface` and `diff_surface` (§8.1) — the two tools the v1 thesis
 * rests on. `diff_surface` is the demo.
 *
 * Response discipline (§8.2) is enforced here rather than left to callers: every
 * response carries `verdict`, `class`, `tier`, `observedAt`, and a coverage note.
 * A bare answer without provenance is indistinguishable from the model's own
 * guess, which is the thing these tools exist to correct.
 *
 * Extraction NEVER runs inside a query (§8). A miss returns UNKNOWN and enqueues;
 * the worker fills it in. That is what keeps the p99 target reachable, and it is
 * also why the miss path has to be honest rather than optimistic.
 */
import { createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { cached } from '../core/cache';
import type { Database } from '../db/client';
import { claims, entities, observations, symbols } from '../db/schema';
import type { SymbolRow } from '../db/schema';
import { enqueueSurface, surfaceRef } from '../db/surface';
import { canonicalKey, type Verdict } from '../graph/types';
import { diffSurfaces } from '../surface/diff';
import type { ExtractedSurface, ExtractionTier, SurfaceSymbol } from '../surface/types';

export interface ResolveSurfaceInput {
  package: string;
  version?: string | null;
}

export interface SurfaceResponse {
  package: string;
  version: string | null;
  verdict: Verdict;
  class: 'declared' | 'executed' | 'derived' | null;
  tier: ExtractionTier | null;
  symbols: { path: string; kind: string; arity: number | null; deprecated: boolean }[];
  /** Always populated: a caller must be able to tell a thin answer from a full one. */
  coverageNote: string;
  observedAt: string | null;
}

/** Stored rows → the extractor's IR, so the diff logic has exactly one implementation. */
function rowsToSurface(
  pkg: string,
  version: string | null,
  rows: SymbolRow[],
  tier: ExtractionTier,
): ExtractedSurface {
  const symbolsOut: SurfaceSymbol[] = rows.map((r) => ({
    path: r.path,
    kind: r.kind,
    arity: r.arity,
    origin: r.origin as SurfaceSymbol['origin'],
    deprecated: r.deprecated,
    tier: r.tier,
    ...(r.sourceFile ? { sourceRef: { file: r.sourceFile, line: r.sourceLine ?? 0 } } : {}),
  }));
  return {
    package: pkg,
    version,
    tier,
    entry: null,
    symbols: symbolsOut,
    filesWalked: 0,
    externalReExports: [],
  };
}

interface StoredSurface {
  entityId: number;
  rows: SymbolRow[];
  verdict: Verdict;
  class: SurfaceResponse['class'];
  tier: ExtractionTier | null;
  observedAt: string | null;
}

/** Look up a stored surface plus the observation that established it. */
async function loadStored(
  db: Database,
  pkg: string,
  version: string | null,
  tenantId = 0,
): Promise<StoredSurface | null> {
  // Surfaces are always STORED under a concrete resolved version, so a query
  // with no version can never match by canonical key. An agent asking "what does
  // zod export?" without pinning is the common call, so fall back to the most
  // recently observed version of that package.
  let entity;
  if (version === null) {
    const rows = await db
      .select({ e: entities, at: observations.observedAt })
      .from(entities)
      .innerJoin(claims, eq(claims.subjectId, entities.id))
      .innerJoin(observations, eq(observations.claimId, claims.id))
      .where(and(eq(entities.kind, 'package_surface'), eq(entities.name, pkg)))
      .orderBy(desc(observations.observedAt))
      .limit(1);
    entity = rows.find((r) => r.e.tenantId === tenantId)?.e;
  } else {
    const key = canonicalKey(surfaceRef(pkg, version));
    const ents = await db.select().from(entities).where(eq(entities.canonicalKey, key)).limit(2);
    entity = ents.find((e) => e.tenantId === tenantId);
  }
  if (!entity) return null;

  const obs = await db
    .select({ o: observations })
    .from(observations)
    .innerJoin(claims, eq(observations.claimId, claims.id))
    .where(eq(claims.subjectId, entity.id))
    .orderBy(desc(observations.observedAt))
    .limit(1);
  const latest = obs[0]?.o ?? null;
  const rows = await db.select().from(symbols).where(eq(symbols.entityId, entity.id));

  return {
    entityId: entity.id,
    rows,
    verdict: latest?.verdict ?? 'unknown',
    class: latest?.class ?? null,
    tier: latest?.tier ?? null,
    observedAt: latest?.observedAt ? latest.observedAt.toISOString() : null,
  };
}

const MISS: Omit<SurfaceResponse, 'package' | 'version'> = {
  verdict: 'unknown',
  class: null,
  tier: null,
  symbols: [],
  coverageNote: 'not yet extracted — queued; retry shortly. This is NOT evidence of absence.',
  observedAt: null,
};

/** Short stable cache key. */
function ckey(parts: unknown): string {
  return createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 24);
}

/**
 * §8 requires p99 < 150 ms for cached reads, so the read path is cached — but a
 * MISS is never cached. The worker is about to fill it in, and a cached UNKNOWN
 * would keep answering "not extracted" long after it was.
 */
export async function handleResolveSurface(
  db: Database,
  input: ResolveSurfaceInput,
): Promise<SurfaceResponse> {
  return cached(
    'resolve_surface',
    ckey([input.package, input.version ?? null]),
    () => resolveSurfaceUncached(db, input),
    { skipCache: (v) => v.verdict === 'unknown' },
  );
}

async function resolveSurfaceUncached(
  db: Database,
  input: ResolveSurfaceInput,
): Promise<SurfaceResponse> {
  const version = input.version ?? null;
  const stored = await loadStored(db, input.package, version);

  if (!stored || (stored.verdict === 'unknown' && stored.rows.length === 0)) {
    // §8: never extract inside a query. Enqueue and answer honestly.
    await enqueueSurface(db, input.package, version).catch(() => {});
    return { package: input.package, version, ...MISS };
  }

  if (stored.verdict === 'undeclared') {
    return {
      package: input.package,
      version,
      verdict: 'undeclared',
      class: stored.class,
      tier: stored.tier,
      symbols: [],
      coverageNote:
        'package ships no artifact this tier can read — UNDECLARED, which is a measurement gap, not an empty API',
      observedAt: stored.observedAt,
    };
  }

  // Runtime surface only: type-only exports break `tsc`, not `node`, and an
  // external re-export is not this package's surface (§6.4.1, §6.4.4).
  const runtime = stored.rows.filter((r) => r.kind !== 'type_only' && r.origin === 'local');
  const excluded = stored.rows.length - runtime.length;

  return {
    package: input.package,
    version,
    verdict: stored.verdict,
    class: stored.class,
    tier: stored.tier,
    symbols: runtime.map((r) => ({
      path: r.path,
      kind: r.kind,
      arity: r.arity,
      deprecated: r.deprecated,
    })),
    coverageNote:
      `${runtime.length} runtime symbol(s)` +
      (excluded ? `; ${excluded} excluded as type-only or re-exported from another package` : '') +
      (stored.tier === 'shipped_js_ast'
        ? '. Runtime existence only — signatures require tier C.'
        : ''),
    observedAt: stored.observedAt,
  };
}

export interface DiffSurfaceInput {
  package: string;
  fromVersion: string;
  toVersion: string;
}

export async function handleDiffSurface(db: Database, input: DiffSurfaceInput) {
  return cached(
    'diff_surface',
    ckey([input.package, input.fromVersion, input.toVersion]),
    () => diffSurfaceUncached(db, input),
    { skipCache: (v) => v.verdict === 'unknown' },
  );
}

async function diffSurfaceUncached(db: Database, input: DiffSurfaceInput) {
  const [a, b] = await Promise.all([
    loadStored(db, input.package, input.fromVersion),
    loadStored(db, input.package, input.toVersion),
  ]);

  const missing: string[] = [];
  if (!a || a.rows.length === 0) missing.push(input.fromVersion);
  if (!b || b.rows.length === 0) missing.push(input.toVersion);
  if (missing.length) {
    for (const v of missing) await enqueueSurface(db, input.package, v).catch(() => {});
    return {
      package: input.package,
      fromVersion: input.fromVersion,
      toVersion: input.toVersion,
      verdict: 'unknown' as const,
      inconclusive: `no extracted surface for ${missing.join(', ')} — queued; retry shortly. NOT evidence that symbols were removed.`,
      removed: [],
      added: [],
      arityChanged: [],
      typeOnlyRemoved: [],
      // Present-but-empty like every other list above, so a miss and a hit have
      // the same shape and callers never have to branch on which one they got.
      deprecated: [],
      observedAt: null,
    };
  }

  const diff = diffSurfaces(
    rowsToSurface(input.package, input.fromVersion, a!.rows, a!.tier ?? 'shipped_js_ast'),
    rowsToSurface(input.package, input.toVersion, b!.rows, b!.tier ?? 'shipped_js_ast'),
  );

  return {
    package: input.package,
    fromVersion: input.fromVersion,
    toVersion: input.toVersion,
    verdict: (diff.inconclusive ? 'unknown' : 'verified_true') as Verdict,
    class: 'derived' as const,
    tier: diff.tier,
    ...(diff.inconclusive ? { inconclusive: diff.inconclusive } : {}),
    /** Breaks `node`. */
    removed: diff.removed.map((s) => ({ path: s.path, kind: s.kind, arity: s.arity })),
    added: diff.added.map((s) => ({ path: s.path, kind: s.kind })),
    arityChanged: diff.arityChanged,
    /** Breaks `tsc`, NOT `node` — returned separately on purpose (§8.1). */
    typeOnlyRemoved: diff.typeOnlyRemoved.map((s) => s.path),
    deprecated: diff.deprecated.map((s) => s.path),
    observedAt: b!.observedAt,
  };
}
