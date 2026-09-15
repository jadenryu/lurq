/**
 * The remote probe drain: lease due endpoints, probe them politely, record what
 * changed, and schedule the next look.
 *
 * Two concurrency limits. The global one bounds the worker's own load. The
 * per-host one bounds what lurq asks of any single operator: hundreds of
 * registry entries live on the same `workers.dev` or `vercel.app` hostnames,
 * and a crawl that fans out by URL would hit one of those hosts dozens of times
 * at once. Endpoints on a host are split into a fixed number of sequential
 * lanes, so no host ever sees more than `perHost` requests in flight from lurq.
 *
 * A failure in lurq's own code (a DB error mid-record) releases the lease and
 * moves on; it is never recorded as a fact about the endpoint.
 */
import { pMap } from '../core/concurrency';
import { formatError } from '../core/errors';
import { logger } from '../core/logger';
import { createSafeFetch, type SafeFetch } from '../core/safeFetch';
import type { Database } from '../db/client';
import { getContract } from '../db/mcpScans';
import {
  claimDueEndpoints,
  getDeclaredHeaders,
  recordEndpointProbe,
  releaseEndpoints,
  type ClaimedEndpoint,
} from '../db/remoteEndpoints';
import { authHash, contractRow, detectChanges } from './changes';
import { probeEndpoint, PROBE_DEFAULTS } from './probe';
import { isFailure, nextProbeAt } from './schedule';
import type { EndpointStatus } from './types';

/** Endpoints probed per worker cycle; the whole registry turns over in a few days at this rate. */
export const REMOTE_PROBES_PER_CYCLE = 200;

export interface RemoteDrainOptions {
  limit?: number;
  concurrency?: number;
  perHost?: number;
  fetch?: SafeFetch;
  budgetMs?: number;
  /** Clock seam for tests. */
  now?: () => Date;
}

export interface RemoteDrainSummary {
  claimed: number;
  probed: number;
  failed: number;
  changes: number;
  byStatus: Partial<Record<EndpointStatus, number>>;
}

/** Split endpoints into lanes: at most `perHost` lanes per host, each probed sequentially. */
export function laneByHost(endpoints: ClaimedEndpoint[], perHost: number): ClaimedEndpoint[][] {
  const lanes: ClaimedEndpoint[][] = [];
  const byHost = new Map<string, ClaimedEndpoint[][]>();
  for (const ep of endpoints) {
    let hostLanes = byHost.get(ep.host);
    if (!hostLanes) {
      hostLanes = [];
      byHost.set(ep.host, hostLanes);
    }
    const shortest = hostLanes.length < perHost ? null : hostLanes.reduce((a, b) => (b.length < a.length ? b : a));
    if (shortest) shortest.push(ep);
    else {
      const lane = [ep];
      hostLanes.push(lane);
      lanes.push(lane);
    }
  }
  return lanes;
}

export async function drainRemoteProbes(db: Database, opts: RemoteDrainOptions = {}): Promise<RemoteDrainSummary> {
  const clock = opts.now ?? (() => new Date());
  const budgetMs = opts.budgetMs ?? PROBE_DEFAULTS.budgetMs;
  const limit = opts.limit ?? REMOTE_PROBES_PER_CYCLE;
  const concurrency = opts.concurrency ?? 16;
  const perHost = opts.perHost ?? 2;
  const summary: RemoteDrainSummary = { claimed: 0, probed: 0, failed: 0, changes: 0, byStatus: {} };

  // A lease long enough for the slowest lane to reach its last endpoint.
  const claimed = await claimDueEndpoints(db, { limit, now: clock(), leaseMs: Math.max(10 * 60_000, (limit / perHost) * budgetMs) });
  summary.claimed = claimed.length;
  if (claimed.length === 0) return summary;

  // A fetch this drain creates is this drain's to close: its keep-alive pool
  // would otherwise hold a `worker --once` process open after the cycle.
  const ownFetch = opts.fetch ? null : createSafeFetch();
  const fetch = opts.fetch ?? ownFetch!;
  const headers = await getDeclaredHeaders(db, claimed.map((c) => c.id));

  const probeOne = async (ep: ClaimedEndpoint) => {
    try {
      const result = await probeEndpoint(ep.url, { fetch, declaredHeaders: headers.get(ep.id) ?? [], budgetMs });
      const row = result.snapshot ? contractRow(result.snapshot) : null;
      const cHash = row?.contentHash ?? null;
      const aHash = authHash(result.auth);

      let prevContract = null;
      if (ep.lastContentHash && cHash && ep.lastContentHash !== cHash) {
        const prev = await getContract(db, ep.lastContentHash);
        if (prev) prevContract = { tools: prev.tools, prompts: prev.prompts, resourceTemplates: prev.resourceTemplates, instructions: prev.instructions };
      }
      const changes = detectChanges(
        { status: ep.lastStatus, contentHash: ep.lastContentHash, authHash: ep.lastAuthHash, auth: ep.auth, contract: prevContract },
        { result, contentHash: cHash, authHash: aHash },
        ep.url,
      );
      const now = clock();
      const failures = isFailure(result.status) ? ep.consecutiveFailures + 1 : 0;
      await recordEndpointProbe(db, {
        endpointId: ep.id,
        result,
        contentHash: cHash,
        authHash: aHash,
        contract: row,
        changes,
        consecutiveFailures: failures,
        nextProbeAt: nextProbeAt({ endpointId: ep.id, status: result.status, consecutiveFailures: failures, lastChangedAt: changes.length ? now : ep.lastChangedAt, now }),
        now,
      });
      summary.probed++;
      summary.changes += changes.length;
      summary.byStatus[result.status] = (summary.byStatus[result.status] ?? 0) + 1;
    } catch (err) {
      summary.failed++;
      logger.warn({ endpoint: ep.url, err: formatError(err) }, 'remote probe: could not record; lease released');
      await releaseEndpoints(db, [ep.id]).catch(() => {});
    }
  };

  try {
    await pMap(laneByHost(claimed, perHost), async (lane) => {
      for (const ep of lane) await probeOne(ep);
    }, concurrency);
  } finally {
    await ownFetch?.close?.().catch(() => {});
  }
  return summary;
}
