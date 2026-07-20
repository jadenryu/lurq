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
  fullyCovered,
  getCompatEdges,
  getPendingCompatVerify,
  pairKey,
  upsertCompatEdge,
} from '../db/compat';
import { getPackageByName, getTopPackageNames } from '../db/packages';
import { getSandbox } from '../sandbox';
import type { SandboxSetResult } from '../sandbox/types';
import { resolveSet } from './resolveCheck';

// Re-exported: the pure pair helpers live in the light db layer (so the query
// path can use them without pulling in the sandbox), but they were minted here.
export { fullyCovered, pairKey } from '../db/compat';

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
 * Tier-2 resolve-only verify (§4C): resolve a package set with npm (no install,
 * no VM) and mint `observed`-class edges — a proven co-resolution, but not the
 * runtime proof a sandbox gives, so it never overrides a `verified`/`conflict`.
 * An ERESOLVE on a pair is a real `conflict`. Inconclusive resolves (network,
 * timeout) throw so the caller can retry rather than record a false result.
 */
export async function resolveVerifyCompatibility(
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
  const edges = pairwiseEdges(resolved, res.resolved);
  await persistCompatEdges(db, edges, 'observed', 'npm-resolve');
  return { edges, resolved: res.resolved };
}

// ── Targeted backfill (§4C) ───────────────────────────────────────────────────

/** Name-pair keys that already have *any* stored edge among `names` — the pairs
 *  a sandbox run would waste itself on (§4C: sandbox is only for unverified). */
async function coveredPairs(db: Database, names: string[]): Promise<Set<string>> {
  const edges = await getCompatEdges(db, names);
  return new Set(edges.map((e) => pairKey(e.packageA, e.packageB)));
}

export interface BackfillResult {
  batches: number;
  verified: number;
  skipped: number;
}

type BatchRunner = (db: Database, batch: string[]) => Promise<{ edges: CompatEdge[] }>;

/**
 * Batch the top-N popular tracked packages and settle each batch with `runner`,
 * minting edges for every pair that mining/Tier-0 left uncovered (§4C). One
 * K-package run yields all C(K,2) edges, so per-edge cost is sublinear; batches
 * already fully covered are skipped — no wasted run. The runner is the tier:
 * sandbox (runtime proof, expensive) or resolve-only (co-resolution, cheap).
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
  const covered = await coveredPairs(db, names);

  let verified = 0;
  let batches = 0;
  let skipped = 0;
  for (let i = 0; i < names.length; i += batchSize) {
    const batch = names.slice(i, i + batchSize);
    if (batch.length < 2) continue;
    if (fullyCovered(batch, covered)) {
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
 * Drain the demand-driven compat-verify queue (§4C): pop the oldest pending sets
 * (capped) and settle each with the *resolve-only* tier (npm resolution, no VM),
 * minting observed/conflict edges so a real `compat` query that missed gets a
 * real answer on the next ask — cheaply. A set already covered by edges since it
 * was queued (backfill/remine/another drain got there first) is dropped without
 * any work; a set that keeps failing (network/timeout — never a proven conflict)
 * is dropped after MAX attempts so a bad request can't wedge the queue. Runtime
 * proof (the sandbox tier) stays with the deliberate `compat-backfill` path.
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
    if (fullyCovered(names, await coveredPairs(db, names))) {
      await deleteCompatVerify(db, req.id);
      continue;
    }
    try {
      const { edges } = await resolveVerifyCompatibility(db, names);
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
    `compat-verify: ${verified} edge(s) from ${pending.length} queued set(s), ${dropped} dropped`,
  );
  return { processed: pending.length, verified, dropped };
}
