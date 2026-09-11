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
import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Database } from './client';
import { claims, entities, observations, packages, surfaceQueue, symbols } from './schema';
import type { SurfaceQueueRow } from './schema';
import { recordObservation, upsertClaim, upsertEntity } from './graph';
import { canonicalKey, type EntityKind, type EntityRef } from '../graph/types';
import type { ExtractedSurface, ExtractionTier } from '../surface/types';

/** The entity ref for a package version's surface. */
export function surfaceRef(pkg: string, version: string | null): EntityRef {
  return { kind: 'package_surface', namespace: 'npm', name: pkg, version };
}

/**
 * The entity ref for an MCP server's tool surface.
 *
 * A DIFFERENT node kind, not a different namespace: `express` the npm package
 * and `express` an MCP server published under the same name are different
 * things with different contracts, and `canonicalKey` puts `kind` first
 * precisely so the two can coexist without one answering for the other. The
 * namespace stays `npm` because that is still where the artifact is fetched
 * from — it is the registry, not the unit type.
 */
export function mcpSurfaceRef(server: string, version: string | null): EntityRef {
  return { kind: 'mcp_server', namespace: 'npm', name: server, version };
}

/**
 * Is a stored surface still good, or does it need extracting again?
 *
 * This compared the tarball digest alone, and a published tarball never
 * changes — so once a package was extracted it was cached forever and no
 * improvement to the extractor could ever reach stored data. Two landed the
 * same day: the ESM-first entry fallback (date-fns and vitest had no readable
 * surface) and namespace member resolution (zod presented as one symbol). A
 * full re-extraction over 2,780 packages reported success and changed nothing,
 * because every call returned 'cached'.
 *
 * The extractor version was already being recorded — `storeSurface` writes it
 * as the observation's `oracleVer` — it was simply never read back. A cache key
 * has to contain everything the value depends on, and the surface depends on
 * the code that produced it as much as on the bytes it was produced from.
 */
export async function isExtractionCached(
  db: Database,
  ref: EntityRef,
  artifactHash: string,
  extractorVersion: string,
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
  if (existing.length === 0) return false;

  // Extracted by which version of the extractor? Anything but the current one
  // is stale by definition, however unchanged the tarball is.
  const seen = await db
    .select({ oracleVer: observations.oracleVer })
    .from(observations)
    .innerJoin(claims, eq(claims.id, observations.claimId))
    .where(
      and(
        eq(claims.subjectId, row.id),
        eq(claims.relation, 'exposes'),
        eq(observations.tier, tier),
      ),
    )
    .orderBy(desc(observations.observedAt))
    .limit(1);
  return seen[0]?.oracleVer === extractorVersion;
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
  opts: {
    artifactHash?: string | null;
    extractorVersion: string;
    tenantId?: number;
    /** Defaults to the npm package-surface ref. Non-npm units pass their own. */
    ref?: EntityRef;
    /** Which oracle established this. Defaults to the tier-A extractor. */
    oracleId?: string;
  } = {
    extractorVersion: '1',
  },
): Promise<{ entityId: number; symbolsWritten: number; verdict: string }> {
  const tenantId = opts.tenantId ?? 0;
  const ref = opts.ref ?? surfaceRef(surface.package, surface.version);
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
    oracleId: opts.oracleId ?? 'surface.tier_a',
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

/**
 * Dedup key for the extraction queue.
 *
 * The npm form is left exactly as it was and the kind is prefixed only for
 * everything else — the same defaulted-parameter trick `ecosystem` uses. Keying
 * every row would have been tidier and would also have orphaned every spec
 * already sitting in the queue, re-enqueueing the whole backlog under new keys
 * for no gain.
 */
export function specKey(
  pkg: string,
  version: string | null,
  kind: EntityKind = 'package_surface',
): string {
  const base = `${pkg}@${version ?? 'latest'}`;
  return kind === 'package_surface' ? base : `${kind}:${base}`;
}

/**
 * Record a query miss (§6.1). Instant, deduped, and never blocking — the query
 * path returns UNKNOWN and the worker does the work.
 */
/**
 * Packages whose LATEST version has no surface in the graph store.
 *
 * Deliberately distinct from `getPackagesMissingSurface` in `db/apiSurfaces`,
 * and the difference is the whole reason this exists. There are two surface
 * stores serving two different questions:
 *
 *   api_surfaces  — a flat export list per version, backing `usage`. Filled by
 *                   the worker's proactive pass, ~26.9k packages covered.
 *   entities +    — structured symbols (kind, arity, origin, deprecation),
 *   symbols         backing `resolve_surface` and `diff_surface`. Only a diff
 *                   can be computed from these, and only ~2.9k are covered.
 *
 * The proactive pass selected its targets with the api_surfaces query and wrote
 * to api_surfaces, so nothing ever proactively filled the graph store — it grew
 * only from demand-driven queue misses at ten per cycle. A package already in
 * api_surfaces was invisible to every backfill even though the diffable store
 * had never seen it, which is why coverage of the differentiated tools sat an
 * order of magnitude below coverage of the cheap one.
 *
 * Sampled at random rather than ordered, for the same reason the sibling query
 * is: a package that repeatedly fails extraction would otherwise sit at the head
 * of every batch forever and starve the rest of the index.
 */
export async function getPackagesMissingGraphSurface(
  db: Database,
  limit: number,
  opts: { byDownloads?: boolean } = {},
): Promise<{ name: string; version: string }[]> {
  // Random is the right default for eventual full coverage — it stops a
  // repeatedly-failing package from sitting at the head of every batch and
  // starving the tail. `byDownloads` is for closing the gap that matters to a
  // user: a real package.json is made of popular packages, so covering the head
  // of the distribution first is what turns `check-upgrade` from a demo into a
  // tool that answers on the dependencies someone actually has.
  const order = opts.byDownloads
    ? sql`${packages.weeklyDownloads} desc nulls last`
    : sql`random()`;
  const rows = await db
    .select({ name: packages.name, version: packages.latestVersion })
    .from(packages)
    .leftJoin(
      entities,
      and(
        eq(entities.kind, 'package_surface'),
        eq(entities.name, packages.name),
        eq(entities.version, packages.latestVersion),
      ),
    )
    .where(and(isNotNull(packages.latestVersion), isNull(entities.id)))
    .orderBy(order)
    .limit(limit);
  return rows.filter((r): r is { name: string; version: string } => r.version !== null);
}

export async function enqueueSurface(
  db: Database,
  pkg: string,
  version: string | null,
  kind: EntityKind = 'package_surface',
): Promise<void> {
  await db
    .insert(surfaceQueue)
    .values({ packageName: pkg, version, kind, specKey: specKey(pkg, version, kind) })
    .onConflictDoNothing();
}

/**
 * Oldest pending specs for ONE extractor, for the worker drain.
 *
 * Filtered by kind rather than returning everything: the two drains do
 * completely different work (static tarball read vs. sandboxed stdio handshake)
 * and handing an MCP spec to the npm drain produces a confident wrong answer
 * rather than an error.
 */
export async function getPendingSurfaces(
  db: Database,
  limit = 10,
  kind: EntityKind = 'package_surface',
): Promise<SurfaceQueueRow[]> {
  return db
    .select()
    .from(surfaceQueue)
    .where(eq(surfaceQueue.kind, kind))
    .orderBy(surfaceQueue.requestedAt)
    .limit(limit);
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

/**
 * Is a surface already stored for this exact `package@version`?
 *
 * Read-only on purpose: `isExtractionCached` goes through `upsertEntity` and so
 * *creates* the entity as a side effect of asking about it, which is fine when
 * you are about to extract but wrong when you are only deciding whether to
 * enqueue. Asking "do we have this?" must not bring it into existence.
 */
export async function hasStoredSurface(
  db: Database,
  pkg: string,
  version: string,
  tier: ExtractionTier = 'shipped_js_ast',
  tenantId = 0,
  kind: EntityKind = 'package_surface',
): Promise<boolean> {
  const key = canonicalKey(
    kind === 'mcp_server' ? mcpSurfaceRef(pkg, version) : surfaceRef(pkg, version),
  );
  const [row] = await db
    .select({ id: entities.id })
    .from(entities)
    .where(and(eq(entities.canonicalKey, key), eq(entities.tenantId, tenantId)))
    .limit(1);
  if (!row) return false;
  const [sym] = await db
    .select({ id: symbols.id })
    .from(symbols)
    .where(and(eq(symbols.entityId, row.id), eq(symbols.tier, tier)))
    .limit(1);
  return sym !== undefined;
}

/**
 * Make `version` diffable by ensuring its predecessor is also extracted.
 *
 * A surface on its own answers "what does this export". The question that
 * actually bites — "what did this release remove or rename" — needs two adjacent
 * versions, and that is exactly what a model trained before the release cannot
 * know. Coverage was one version deep for all but 4.5% of packages, which is why
 * the diff existed but almost never had anything to compare.
 *
 * Bounded on purpose: N-1 only, never the whole timeline. One extra extraction
 * per package, once, and thereafter the publish feed keeps the pair rolling
 * forward on its own. Full history would be 91 versions per package for a
 * question nobody asks — people upgrade from the version they are on.
 */
export async function enqueuePreviousSurface(
  db: Database,
  pkg: string,
  version: string,
  history: { version: string }[],
  kind: EntityKind = 'package_surface',
): Promise<boolean> {
  const previous = previousVersion(history, version);
  if (previous === null) return false;
  const tier: ExtractionTier = kind === 'mcp_server' ? 'mcp_tools_list' : 'shipped_js_ast';
  if (await hasStoredSurface(db, pkg, previous, tier, 0, kind)) return false;
  await enqueueSurface(db, pkg, previous, kind);
  return true;
}

/**
 * The version published immediately before `version`, given a newest-first
 * timeline. Null when there is nothing to compare against.
 *
 * Ordering comes from `published_at`, not from semver, and that is deliberate:
 * a backport releasing 3.9.2 after 4.0.0 shipped means the predecessor by time
 * is not the predecessor by number. The question a diff answers is "what changed
 * when this was released", so publication order is the honest one.
 */
export function previousVersion(
  history: { version: string }[],
  version: string,
): string | null {
  const idx = history.findIndex((h) => h.version === version);
  // Not in the timeline, or already the oldest we know: nothing to compare to.
  if (idx === -1 || idx + 1 >= history.length) return null;
  return history[idx + 1]!.version ?? null;
}
