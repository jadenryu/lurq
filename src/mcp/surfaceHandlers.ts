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
import { and, desc, eq, inArray } from 'drizzle-orm';
import { cached } from '../core/cache';
import type { Database } from '../db/client';
import { claims, entities, observations, symbols } from '../db/schema';
import { UNBOUNDED_ARITY, type SymbolRow } from '../db/schema';
import { enqueueSurface, mcpSurfaceRef, surfaceRef } from '../db/surface';
import { PUBLIC_TENANT } from '../db/graph';
import { needsFill, scheduleFill } from '../pipeline/fillSurface';
import { canonicalKey, type EntityKind, type Verdict } from '../graph/types';
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
export function rowsToSurface(
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
    // The signature was dropped on the way back out of the database, so every
    // diff computed from STORED rows saw `signature: undefined` on both sides
    // and reported no signature drift — for tier C, where signatures are the
    // only thing that tier can report, and for the MCP tier, where the entire
    // tool contract is serialized into this field.
    ...(r.signature !== null ? { signature: r.signature } : {}),
    // Offset and maximum arity come back too. Without them a diff computed from
    // stored rows could never find a proven rename or a dropped trailing
    // parameter, and every consumer of the index would see less than the CLI.
    ...(r.sourceFile
      ? {
          sourceRef: {
            file: r.sourceFile,
            line: r.sourceLine ?? 0,
            ...(r.sourceOffset !== null ? { offset: r.sourceOffset } : {}),
          },
        }
      : {}),
    ...(r.maxArity !== null
      ? { maxArity: r.maxArity === UNBOUNDED_ARITY ? null : r.maxArity }
      : {}),
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

export interface StoredSurface {
  entityId: number;
  rows: SymbolRow[];
  verdict: Verdict;
  class: SurfaceResponse['class'];
  tier: ExtractionTier | null;
  observedAt: string | null;
  /** True when this came from the caller's own tenant rather than the public graph. */
  private: boolean;
}

/**
 * Look up a stored surface plus the observation that established it.
 *
 * `kind` selects the unit type: an npm package's extracted exports, or an MCP
 * server's tool list. They live in the same two tables and are told apart by the
 * node kind, which is the first segment of `canonicalKey` for exactly this
 * reason — a package and a server published under the same name are different
 * subjects with different contracts.
 */
export async function loadStored(
  db: Database,
  pkg: string,
  version: string | null,
  tenantId = PUBLIC_TENANT,
  kind: EntityKind = 'package_surface',
): Promise<StoredSurface | null> {
  // Surfaces are always STORED under a concrete resolved version, so a query
  // with no version can never match by canonical key. An agent asking "what does
  // zod export?" without pinning is the common call, so fall back to the most
  // recently observed version of that package.
  //
  // Visible set: the caller's own tenant plus the public graph, with the
  // caller's own row winning. A team that publishes an internal fork of a public
  // name is running the fork, so that is the surface their agent must be told
  // about — but falling back to public is what keeps the rest of the index
  // working for them at all.
  //
  // Both predicates belong in SQL. Filtering after LIMIT (what this used to do)
  // reads one row and then discards it for the wrong tenant, which returns a
  // false MISS rather than the row that was actually wanted.
  const visible = inArray(entities.tenantId, [tenantId, PUBLIC_TENANT]);
  let entity;
  if (version === null) {
    const rows = await db
      .select({ e: entities })
      .from(entities)
      .innerJoin(claims, eq(claims.subjectId, entities.id))
      .innerJoin(observations, eq(observations.claimId, claims.id))
      .where(and(eq(entities.kind, kind), eq(entities.name, pkg), visible))
      .orderBy(desc(entities.tenantId), desc(observations.observedAt))
      .limit(1);
    entity = rows[0]?.e;
  } else {
    const key = canonicalKey(
      kind === 'mcp_server' ? mcpSurfaceRef(pkg, version) : surfaceRef(pkg, version),
    );
    const ents = await db
      .select()
      .from(entities)
      .where(and(eq(entities.canonicalKey, key), visible))
      .orderBy(desc(entities.tenantId))
      .limit(1);
    entity = ents[0];
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
    private: entity.tenantId !== PUBLIC_TENANT,
  };
}

const MISS: Omit<SurfaceResponse, 'package' | 'version'> = {
  verdict: 'unknown',
  class: null,
  tier: null,
  symbols: [],
  coverageNote: 'not yet extracted, queued; retry shortly. This is NOT evidence of absence.',
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
  tenantId = PUBLIC_TENANT,
): Promise<SurfaceResponse> {
  return cached(
    'resolve_surface',
    // The tenant is part of the key, not just the query. Redis is shared across
    // every request this process serves, so a key that omits it would hand one
    // account's private surface to the next caller asking for that name.
    ckey([tenantId, input.package, input.version ?? null]),
    () => resolveSurfaceUncached(db, input, tenantId),
    { skipCache: (v) => v.verdict === 'unknown' },
  );
}

async function resolveSurfaceUncached(
  db: Database,
  input: ResolveSurfaceInput,
  tenantId: number,
): Promise<SurfaceResponse> {
  const version = input.version ?? null;
  let stored = await loadStored(db, input.package, version, tenantId);

  // §8 said never extract inside a query. That rule is relaxed here
  // deliberately, not by accident.
  //
  // What it protected against was unbounded work on a request path. What it
  // cost was that the only store able to answer "what changed between these two
  // versions" grew solely at the rate of a queue drain, while `usage` — which
  // does extract inside a query, within a budget — filled itself to nearly ten
  // times the coverage using the same extractor at half a second a package.
  //
  // The original concern is addressed rather than ignored: the wait is bounded
  // by a wall-clock budget, concurrent misses for one version share a single
  // fetch, in-flight extractions are capped, and every failure path falls
  // through to exactly the enqueue-and-answer-honestly behaviour below. A
  // caller waits at most the budget; it never waits on unbounded work.
  if (!stored || (stored.verdict === 'unknown' && stored.rows.length === 0)) {
    const { firstTouchSurface } = await import('../pipeline/firstTouch');
    if (await firstTouchSurface(db, input.package, version)) {
      stored = await loadStored(db, input.package, version, tenantId);
    }
  }

  if (!stored || (stored.verdict === 'unknown' && stored.rows.length === 0)) {
    // Nothing within the budget. Queue it so a retry is a cache hit, and answer
    // honestly — the extraction may still be running and will warm the cache.
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
        'package ships no artifact this tier can read, UNDECLARED, which is a measurement gap, not an empty API',
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
        ? '. Runtime existence only, signatures require tier C.'
        : '') +
      // Which graph answered is provenance, not decoration: an agent debugging a
      // wrong answer has to be able to tell your fork from the public package.
      (stored.private ? ' Answered from your own published surface, not the public index.' : ''),
    observedAt: stored.observedAt,
  };
}

export interface DiffSurfaceInput {
  package: string;
  fromVersion: string;
  toVersion: string;
}

export async function handleDiffSurface(
  db: Database,
  input: DiffSurfaceInput,
  tenantId = PUBLIC_TENANT,
) {
  // An answer computed while a side is being backfilled is about to go stale:
  // the fill can add renames it could not see. It is served, but not cached.
  let filling = false;
  return cached(
    'diff_surface',
    // Tenant-keyed for the same reason as resolve_surface: a shared cache that
    // ignores it serves one account's private diff to everyone else.
    ckey([tenantId, input.package, input.fromVersion, input.toVersion]),
    () => diffSurfaceUncached(db, input, () => (filling = true), tenantId),
    { skipCache: (v) => v.verdict === 'unknown' || filling },
  );
}

async function diffSurfaceUncached(
  db: Database,
  input: DiffSurfaceInput,
  onFill: () => void,
  tenantId: number,
) {
  let [a, b] = await Promise.all([
    loadStored(db, input.package, input.fromVersion, tenantId),
    loadStored(db, input.package, input.toVersion, tenantId),
  ]);

  // Both halves are raced under ONE shared budget (see firstTouch.ts): a diff
  // needs both, so extracting sequentially would let a slow `from` eat the
  // budget and leave `to` unstarted.
  if (!a || !b || a.rows.length === 0 || b.rows.length === 0) {
    const { firstTouchPair } = await import('../pipeline/firstTouch');
    if (await firstTouchPair(db, input.package, input.fromVersion, input.toVersion)) {
      [a, b] = await Promise.all([
        loadStored(db, input.package, input.fromVersion, tenantId),
        loadStored(db, input.package, input.toVersion, tenantId),
      ]);
    }
  }

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
      inconclusive: `no extracted surface for ${missing.join(', ')}, queued; retry shortly. NOT evidence that symbols were removed.`,
      removed: [],
      added: [],
      arityChanged: [],
      typeOnlyRemoved: [],
      // Present-but-empty like every other list above, so a miss and a hit have
      // the same shape and callers never have to branch on which one they got.
      deprecated: [],
      renamed: [],
      observedAt: null,
    };
  }

  // Rows stored before migration 0037 carry no offsets or argument limits, so
  // they cannot prove a rename. Fill them behind this answer, never in front of
  // it; see pipeline/fillSurface.ts for what keeps that cheap.
  for (const [stored, version] of [
    [a!, input.fromVersion],
    [b!, input.toVersion],
  ] as const) {
    if (needsFill(stored.rows) && scheduleFill(db, input.package, version, stored.entityId))
      onFill();
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
    /** Removed names whose implementation the package still exports under another
     *  name. Empty for surfaces stored before declaration offsets were recorded. */
    renamed: diff.renamed,
    observedAt: b!.observedAt,
  };
}
