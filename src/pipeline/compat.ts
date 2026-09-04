/**
 * Compatibility verification: co-install a set of packages in the sandbox and
 * record pairwise edges. A successful co-install proves the set coexists (every
 * pair compatible); a 2-package failure proves that pair conflicts. A larger
 * failed set can't pin the culprit, so no edge is asserted (set-level report).
 */
import type { CompatStatus } from '../core/types';
import { logger } from '../core/logger';
import type { Database } from '../db/client';
import {
  bumpCompatVerifyAttempt,
  canonicalPair,
  deleteCompatVerify,
  getPendingCompatVerify,
  upsertCompatEdge,
} from '../db/compat';
import { getStackResolution, recordStackResolution, stackKey } from '../db/stackResolutions';
import { getPackageByName, getTopPackageNames } from '../db/packages';
import { getSandbox } from '../sandbox';
import type { SandboxSetResult } from '../sandbox/types';
import { resolveSet } from './resolveCheck';

// Re-exported: the pure pair helper lives in the light db layer (so the query
// path can use it without pulling in the sandbox), but it was minted here.
export { pairKey } from '../db/compat';

export interface CompatEdge {
  a: string;
  aVersion: string;
  b: string;
  bVersion: string;
  status: CompatStatus;
}

interface Resolved {
  name: string;
  version: string;
}

/**
 * Pairwise edges from a set-level outcome. Pure, shared by every tier (sandbox
 * co-install, resolve-only): a success proves the whole set coexists → every pair
 * compatible; a failed *pair* is precise → conflict; a larger failed set can't
 * attribute the culprit → no edge.
 */
function pairwiseEdges(resolved: Resolved[], success: boolean): CompatEdge[] {
  const edges: CompatEdge[] = [];
  if (success) {
    for (let i = 0; i < resolved.length; i++) {
      for (let j = i + 1; j < resolved.length; j++) {
        edges.push({
          a: resolved[i]!.name,
          aVersion: resolved[i]!.version,
          b: resolved[j]!.name,
          bVersion: resolved[j]!.version,
          status: 'compatible',
        });
      }
    }
  } else if (resolved.length === 2) {
    edges.push({
      a: resolved[0]!.name,
      aVersion: resolved[0]!.version,
      b: resolved[1]!.name,
      bVersion: resolved[1]!.version,
      status: 'conflict',
    });
  }
  return edges;
}

/** Derive pairwise edges from a sandbox set co-install result. Pure. */
export function deriveCompatEdges(resolved: Resolved[], result: SandboxSetResult): CompatEdge[] {
  return pairwiseEdges(resolved, result.installed && result.loaded.every((l) => l.loaded === true));
}

export interface CompatRunResult {
  result: SandboxSetResult;
  edges: CompatEdge[];
  /** A set-level conflict that couldn't be pinned to a specific pair. */
  unattributedConflict: boolean;
}

export async function verifyCompatibility(
  db: Database,
  packages: string[],
  opts: { allowScripts?: boolean } = {},
): Promise<CompatRunResult> {
  const resolved: Resolved[] = await Promise.all(
    packages.map(async (name) => ({
      name,
      version: (await getPackageByName(db, name))?.latestVersion ?? 'latest',
    })),
  );

  const result = await (await getSandbox()).verifySet(
    resolved.map((r) => ({ name: r.name, version: r.version === 'latest' ? null : r.version })),
    { allowScripts: opts.allowScripts },
  );

  const edges = deriveCompatEdges(resolved, result);
  await persistCompatEdges(db, edges, 'verified', result.driver);

  const failed = !result.installed || !result.loaded.every((l) => l.loaded === true);
  return { result, edges, unattributedConflict: failed && edges.length === 0 };
}

/** Upsert derived edges with a given evidence class. A compatible edge carries the
 *  caller's provenance (`verified` for sandbox runtime proof, `observed` for a
 *  resolve-only co-resolution witness); a conflict is always the proven-negative
 *  `conflict`. Provenance precedence means a weaker tier never erases a stronger. */
async function persistCompatEdges(
  db: Database,
  edges: CompatEdge[],
  compatibleProvenance: 'verified' | 'observed',
  driver: string,
): Promise<void> {
  const now = new Date();
  for (const e of edges) {
    const pair = canonicalPair(
      { name: e.a, version: e.aVersion },
      { name: e.b, version: e.bVersion },
    );
    await upsertCompatEdge(db, {
      ...pair,
      status: e.status,
      provenance: e.status === 'conflict' ? 'conflict' : compatibleProvenance,
      // Witness accrues for co-resolution evidence (`observed`); ignored otherwise.
      witnessCount: e.status === 'compatible' && compatibleProvenance === 'observed' ? 1 : 0,
      driver,
      ranAt: now,
    }).catch(() => {});
  }
}

export interface ResolveCompatResult {
  edges: CompatEdge[];
  /** True if the set co-resolves; false only on a proven ERESOLVE conflict. */
  resolved: boolean;
}

/**
 * Tier-2 resolve-only verify: resolve a package set with npm (no install, no VM)
 * and record the verdict against the exact set.
 *
 * This used to fan the result out into pairwise `observed` edges. It no longer
 * does, and the reason is not just storage: a set resolving is a fact about the
 * *set*. Splitting it into C(n,2) pairs asserts something npm never said — that
 * each pair independently works — and loses the only thing that made the run
 * worth doing, which is that these packages resolve *together*.
 *
 * Inconclusive resolves (network, timeout) throw so the caller can retry rather
 * than record a false result. Nothing is cached on that path.
 */
async function resolveVerifyCompatibility(
  db: Database,
  packages: string[],
): Promise<ResolveCompatResult> {
  const resolved: Resolved[] = await Promise.all(
    packages.map(async (name) => ({
      name,
      version: (await getPackageByName(db, name))?.latestVersion ?? 'latest',
    })),
  );
  const res = await resolveSet(
    resolved.map((r) => ({ name: r.name, version: r.version === 'latest' ? null : r.version })),
  );
  // A member we could not pin has no place in a version-keyed cache entry.
  const pinned = resolved.filter((r) => r.version !== 'latest');
  if (pinned.length === resolved.length && pinned.length >= 2) {
    await recordStackResolution(db, {
      members: pinned.map((r) => ({ name: r.name, version: r.version })),
      resolved: res.resolved,
      reason: res.reason,
      detail: res.detail ?? null,
    }).catch((err: unknown) => logger.warn(`compat: caching resolution failed: ${String(err)}`));
  }
  return { edges: pairwiseEdges(resolved, res.resolved), resolved: res.resolved };
}

// ── Targeted backfill (§4C) ───────────────────────────────────────────────────

/**
 * Has this exact set already been resolved? The backfill skips it if so.
 *
 * Set-level, where the old check was pairwise. That is a real narrowing: a batch
 * whose pairs were each seen in some *other* combination used to count as
 * covered, which is precisely the inference npm's resolver does not support —
 * pairwise coverage never proved the batch resolves together. Now a batch is
 * skipped only when this batch, at these versions, actually resolved.
 */
async function alreadyResolved(db: Database, names: string[]): Promise<boolean> {
  const members: { name: string; version: string }[] = [];
  for (const name of [...new Set(names)]) {
    const version = (await getPackageByName(db, name))?.latestVersion;
    if (!version) return false; // cannot key on it, so treat as uncovered
    members.push({ name, version });
  }
  if (members.length < 2) return true;
  return (await getStackResolution(db, stackKey(members)).catch(() => null)) !== null;
}

export interface BackfillResult {
  batches: number;
  verified: number;
  skipped: number;
}

type BatchRunner = (db: Database, batch: string[]) => Promise<{ edges: CompatEdge[] }>;

/**
 * Batch the top-N popular tracked packages and settle each batch with `runner`.
 * Batches already resolved at these versions are skipped — no wasted run. The
 * runner is the tier: sandbox (runtime proof, expensive) or resolve-only
 * (co-resolution, cheap).
 *
 * `batchSize` is worth raising well above its default before running this in
 * anger. npm's cost is dominated by fetching packuments rather than by how many
 * packages are in the set, so a batch of 20 measured ~31ms per covered pair
 * against ~450ms at a batch of 5.
 */
async function runBackfill(
  db: Database,
  opts: { topN?: number; batchSize?: number },
  runner: BatchRunner,
  label: string,
): Promise<BackfillResult> {
  const topN = opts.topN ?? 50;
  const batchSize = Math.max(2, opts.batchSize ?? 5);
  const names = await getTopPackageNames(db, topN);

  let verified = 0;
  let batches = 0;
  let skipped = 0;
  for (let i = 0; i < names.length; i += batchSize) {
    const batch = names.slice(i, i + batchSize);
    if (batch.length < 2) continue;
    if (await alreadyResolved(db, batch)) {
      skipped++;
      continue;
    }
    logger.info(`${label}: ${batch.join(', ')}`);
    const { edges } = await runner(db, batch).catch((err) => {
      logger.warn(`${label} batch failed (${batch.join(', ')}): ${String(err)}`);
      return { edges: [] as CompatEdge[] };
    });
    verified += edges.length;
    batches++;
  }
  logger.info(`${label}: ${verified} edges across ${batches} runs, ${skipped} batches skipped`);
  return { batches, verified, skipped };
}

/** Sandbox backfill (Tier-3, runtime proof) — reserve E2B for where it buys most. */
export async function backfillVerify(
  db: Database,
  opts: { topN?: number; batchSize?: number } = {},
): Promise<BackfillResult> {
  return runBackfill(db, opts, verifyCompatibility, 'backfill(sandbox)');
}

/** Resolve-only backfill (Tier-2, no VM) — cheap enough to pre-warm the whole
 *  corpus before launch; escalate ambiguous pairs to `backfillVerify` later. */
export async function resolveBackfill(
  db: Database,
  opts: { topN?: number; batchSize?: number } = {},
): Promise<BackfillResult> {
  return runBackfill(db, opts, resolveVerifyCompatibility, 'backfill(resolve)');
}

// ── Demand-driven self-heal drain (§4C) ───────────────────────────────────────

const MAX_COMPAT_VERIFY_ATTEMPTS = 3;

export interface DrainResult {
  processed: number;
  verified: number;
  dropped: number;
}

/**
 * Drain the compat-verify queue: pop the oldest pending sets (capped) and settle
 * each in the *sandbox* — a real co-install under VM isolation.
 *
 * The queue's job changed. It used to hold sets whose verdict was unknown, so a
 * cheap resolve could turn the next ask from `likely` into an answer. `compat`
 * now resolves inline, so by the time anything lands here the set has already
 * been proven to *install*. What is left unproven is whether it actually *runs*,
 * and that is exactly what the sandbox tier establishes — the one claim neither
 * a resolution nor a dependency graph can make.
 *
 * A set resolved since it was queued is dropped without work; a set that keeps
 * failing (network/timeout — never a proven conflict) is dropped after MAX
 * attempts so a bad request cannot wedge the queue.
 */
export async function drainCompatVerifyQueue(
  db: Database,
  opts: { limit?: number } = {},
): Promise<DrainResult> {
  const limit = Math.max(1, opts.limit ?? 10);
  const pending = await getPendingCompatVerify(db, limit);
  let verified = 0;
  let dropped = 0;
  for (const req of pending) {
    const names = req.packages;
    if (await alreadyResolved(db, names)) {
      await deleteCompatVerify(db, req.id);
      continue;
    }
    try {
      const { edges } = await verifyCompatibility(db, names, {});
      verified += edges.length;
      await deleteCompatVerify(db, req.id);
    } catch (err) {
      logger.warn(`compat-verify drain failed for ${names.join(', ')}: ${String(err)}`);
      const attempts = await bumpCompatVerifyAttempt(db, req.id);
      if (attempts >= MAX_COMPAT_VERIFY_ATTEMPTS) {
        await deleteCompatVerify(db, req.id);
        dropped++;
      }
    }
  }
  logger.info(
    `compat-verify(sandbox): ${verified} edge(s) from ${pending.length} queued set(s), ${dropped} dropped`,
  );
  return { processed: pending.length, verified, dropped };
}
