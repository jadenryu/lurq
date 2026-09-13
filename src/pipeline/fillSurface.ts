/**
 * Lazy, update-only backfill of declaration offsets and argument limits.
 *
 * Migration 0039 added `symbols.source_offset` and `symbols.max_arity` (they were
 * first written as a 0037 that a migration-number collision dropped from main). Rows
 * stored before it have neither, so a diff read from the index cannot prove a
 * rename or a dropped trailing parameter for those versions. Re-extracting the
 * whole store would put every row through `storeSurface`, which deletes and
 * re-inserts; this instead fills the two columns in place, only for versions a
 * diff actually asks about, and only where they are still empty.
 *
 * Cheap by construction:
 *   - never on the request's clock: the diff answers first, the fill follows;
 *   - one fill at a time, yielding between jobs, so a burst of diffs from one
 *     brief page queues up instead of competing with live requests;
 *   - each version is tried at most once per process, filled or not, so a
 *     package whose exports carry no offsets is not re-downloaded on every call;
 *   - a capped queue: past it a version simply waits for a later request.
 */
import { sql } from 'drizzle-orm';
import { logger } from '../core/logger';
import type { Database } from '../db/client';
import { UNBOUNDED_ARITY, type SymbolRow } from '../db/schema';

const TIER = 'shipped_js_ast';
const MAX_QUEUED = 32;
/** Bound on the once-per-process memory; past it, versions may be tried again. */
const MAX_ATTEMPTED = 50_000;
const BATCH = 500;

export type FillFn = (db: Database, pkg: string, version: string, entityId: number) => Promise<number>;

interface FillJob {
  db: Database;
  pkg: string;
  version: string;
  entityId: number;
  fill: FillFn;
}

const attempted = new Set<string>();
const pending = new Set<string>();
const queue: FillJob[] = [];
let draining: Promise<void> | null = null;

/** Were these rows stored before offsets existed? Every tier-A row lacks both. */
export function needsFill(rows: Pick<SymbolRow, 'tier' | 'sourceOffset' | 'maxArity'>[]): boolean {
  const tierA = rows.filter((r) => r.tier === TIER);
  return tierA.length > 0 && tierA.every((r) => r.sourceOffset === null && r.maxArity === null);
}

/**
 * Queue a version for filling. Never waits. True when a fill is queued or
 * running for it, which tells the caller its current answer is about to go stale.
 */
export function scheduleFill(
  db: Database,
  pkg: string,
  version: string,
  entityId: number,
  fill: FillFn = fillOne,
): boolean {
  const key = `${pkg}@${version}`;
  if (pending.has(key)) return true;
  if (attempted.has(key) || queue.length >= MAX_QUEUED) return false;
  if (attempted.size >= MAX_ATTEMPTED) attempted.clear();
  attempted.add(key);
  pending.add(key);
  queue.push({ db, pkg, version, entityId, fill });
  draining ??= drain().finally(() => {
    draining = null;
  });
  return true;
}

async function drain(): Promise<void> {
  for (let job = queue.shift(); job; job = queue.shift()) {
    const key = `${job.pkg}@${job.version}`;
    try {
      const updated = await job.fill(job.db, job.pkg, job.version, job.entityId);
      logger.info(`surface fill ${key}: ${updated} symbol row(s) updated`);
    } catch (err) {
      logger.warn(`surface fill failed for ${key}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      pending.delete(key);
    }
    // Let queued requests run between jobs: extraction parses synchronously.
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Extract one version and write its offsets and argument limits onto the rows it already has. */
export async function fillOne(db: Database, pkg: string, version: string, entityId: number): Promise<number> {
  // Lazy for the same reason firstTouch.ts gives: extraction pulls in the compiler.
  const { fetchAndExtract } = await import('../surface/fetch');
  const fetched = await fetchAndExtract(pkg, version);
  if (!fetched) return 0;

  const values = fetched.surface.symbols
    .filter((s) => s.tier === TIER && (s.sourceRef?.offset !== undefined || s.maxArity !== undefined))
    .map((s) => ({
      path: s.path,
      offset: s.sourceRef?.offset ?? null,
      maxArity: s.maxArity === undefined ? null : (s.maxArity ?? UNBOUNDED_ARITY),
    }));

  let updated = 0;
  for (let i = 0; i < values.length; i += BATCH) {
    const res = await db.execute(fillStatement(entityId, values.slice(i, i + BATCH)));
    updated += (res as { count?: number }).count ?? 0;
  }
  return updated;
}

/**
 * The only write this module makes: an UPDATE of the two new columns, matched on
 * the row's own key, and only where both are still empty. A symbol whose path no
 * longer matches keeps its nulls, which reads as "no proof", exactly as before.
 */
export function fillStatement(
  entityId: number,
  values: { path: string; offset: number | null; maxArity: number | null }[],
) {
  const rows = sql.join(
    values.map((v) => sql`(${v.path}, ${v.offset}::int, ${v.maxArity}::int)`),
    sql`, `,
  );
  return sql`
    UPDATE symbols AS s
    SET source_offset = v.new_offset, max_arity = v.new_max_arity
    FROM (VALUES ${rows}) AS v(path, new_offset, new_max_arity)
    WHERE s.entity_id = ${entityId}
      AND s.tier = ${TIER}
      AND s.path = v.path
      AND s.source_offset IS NULL
      AND s.max_arity IS NULL`;
}

/** Test-only: forget attempts and wait for any running drain. */
export async function resetSurfaceFill(): Promise<void> {
  queue.length = 0;
  await draining;
  attempted.clear();
  pending.clear();
}
