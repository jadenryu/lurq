/**
 * Autonomous discovery worker (§4G). One bounded loop that grows the frontier so
 * packages + edges + surfaces compound without human curation:
 *
 *   drain queue → ingest → mine → extract → surface → sleep → repeat
 *
 * Discovery and asset-building are the *same crawl* (§4G) — no separate matrix
 * job. Ingest mines observed edges (§4B) as a side effect; this loop adds the
 * bounded surface-extraction (§4D) and freshness-rescore passes. Owner-run:
 * `lurq worker` starts it; SIGINT/SIGTERM stops it cleanly after the current
 * cycle. Every candidate still clears the quality gate before it's served.
 */
import { logger } from '../core/logger';
import { createDb } from '../db/client';
import { getPackagesMissingSurface, recordSurfaceMiss } from '../db/apiSurfaces';
import { enqueueSurface, hasStoredSurface, surfaceQueueDepth } from '../db/surface';
import { pMap } from '../core/concurrency';
import { runDiscovery } from './discovery';
import { drainCompatVerifyQueue } from './compat';
import { drainSurfaceQueue } from './surface';
import { drainMcpQueue, MCP_PER_CYCLE } from './mcp';

export interface WorkerOptions {
  /** Seconds between cycles (default 900 = 15 min). */
  intervalSec?: number;
  /** Candidates ingested per discovery cycle. */
  perRunCap?: number;
  /** API surfaces extracted per cycle. */
  extractPerCycle?: number;
  /** Demand-driven compat-verify sets drained per cycle (§4C). */
  compatVerifyPerCycle?: number;
  /** Demand-driven surface extractions drained per cycle (v1 §6.1). */
  surfacePerCycle?: number;
  /** MCP servers probed per cycle. Small: each one spawns a sandbox. */
  mcpPerCycle?: number;
  /** Remote MCP endpoints probed per cycle (HTTP only, no sandbox). */
  remoteProbesPerCycle?: number;
  /** Sync the official MCP registry each cycle (incremental). Default true. */
  registrySync?: boolean;
  /** Run exactly one cycle and return (for tests / cron). */
  once?: boolean;
}

export interface ExtractOutcome {
  name: string;
  version: string;
  ok: boolean;
}

/** The storage operations the extraction pass needs, injected so its rules are testable. */
export interface ExtractPassIo {
  recordMiss(name: string, version: string): Promise<void>;
  hasSymbolSurface(name: string, version: string): Promise<boolean>;
  enqueueSymbolSurface(name: string, version: string): Promise<void>;
  queueDepth(): Promise<number>;
  headroom: number;
}

/**
 * Record what the extraction pass learned.
 *
 * A failure counts against that version's attempt budget. A success is also
 * handed to the symbol store (`entities`/`symbols`, which `resolve_surface`,
 * `diff_surface` and `check-upgrade` read) — this pass writes only
 * `api_surfaces`, so without it the two stores covered different packages.
 * Handed over only while the surface queue has headroom, so demand-driven
 * misses never wait behind this backfill. Returns how many were queued.
 */
export async function recordExtractOutcomes(
  results: ExtractOutcome[],
  io: ExtractPassIo,
): Promise<number> {
  for (const r of results) if (!r.ok) await io.recordMiss(r.name, r.version);

  let room = io.headroom - (await io.queueDepth());
  let queued = 0;
  for (const r of results) {
    if (room <= 0) break;
    if (!r.ok || (await io.hasSymbolSurface(r.name, r.version))) continue;
    await io.enqueueSymbolSurface(r.name, r.version);
    room--;
    queued++;
  }
  return queued;
}

/** Extract surfaces for tracked packages that don't have one yet (§4D/§4G). */
async function extractSurfacesPass(limit: number): Promise<number> {
  const handle = createDb({ max: 4 });
  try {
    const missing = await getPackagesMissingSurface(handle.db, limit);
    if (missing.length === 0) return 0;
    // Kept off the module graph: extraction needs the TypeScript compiler, and
    // a static import made every operator command require it at boot.
    const { getOrExtractSurface } = await import('../usage/service');
    const results = await pMap(
      missing,
      (p) =>
        getOrExtractSurface(handle.db, p.name, p.version).then(
          (s) => ({ ...p, ok: Boolean(s) }),
          () => ({ ...p, ok: false }),
        ),
      4,
    );
    const extracted = results.filter((r) => r.ok).length;

    const db = handle.db;
    const { QUEUE_HEADROOM } = await import('../mcp/publicUpgrades');
    const followed = await recordExtractOutcomes(results, {
      recordMiss: (name, version) => recordSurfaceMiss(db, name, version),
      hasSymbolSurface: (name, version) => hasStoredSurface(db, name, version),
      enqueueSymbolSurface: (name, version) => enqueueSurface(db, name, version),
      queueDepth: () => surfaceQueueDepth(db),
      headroom: QUEUE_HEADROOM,
    });
    logger.info(
      `worker: extracted ${extracted}/${missing.length} API surfaces, ${followed} queued for the symbol store`,
    );
    return extracted;
  } finally {
    await handle.close();
  }
}

/** Sleep in ≤1s slices so a stop signal interrupts the wait promptly. */
async function interruptibleSleep(seconds: number, stopped: () => boolean): Promise<void> {
  const endAt = Date.now() + seconds * 1000;
  while (Date.now() < endAt && !stopped()) {
    await new Promise((r) => setTimeout(r, Math.min(1000, endAt - Date.now())));
  }
}

export async function runWorker(opts: WorkerOptions = {}): Promise<void> {
  const intervalSec = opts.intervalSec ?? 900;
  const extractPerCycle = opts.extractPerCycle ?? 25;
  const compatVerifyPerCycle = opts.compatVerifyPerCycle ?? 10;
  const surfacePerCycle = opts.surfacePerCycle ?? 10;
  const mcpPerCycle = opts.mcpPerCycle ?? MCP_PER_CYCLE;

  let stopped = false;
  const stop = (sig: string) => {
    if (stopped) return;
    stopped = true;
    logger.info(`worker: ${sig} received, finishing the current cycle, then stopping.`);
  };
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));

  let cycle = 0;
  do {
    cycle++;
    logger.info(`worker: cycle ${cycle} starting`);
    // Discovery ingests survivors, and ingest mines observed edges (§4B).
    await runDiscovery({ perRunCap: opts.perRunCap }).catch((err) =>
      logger.warn(`worker: discovery failed: ${String(err)}`),
    );
    await extractSurfacesPass(extractPerCycle).catch((err) =>
      logger.warn(`worker: extraction pass failed: ${String(err)}`),
    );
    // Self-heal the compat matrix from real query misses (§4C) — bounded sandbox
    // runs, off the HTTP path. A fresh DB handle keeps the sandbox work isolated.
    await (async () => {
      const handle = createDb({ max: 4 });
      try {
        await drainCompatVerifyQueue(handle.db, { limit: compatVerifyPerCycle });
      } finally {
        await handle.close();
      }
    })().catch((err) => logger.warn(`worker: compat-verify drain failed: ${String(err)}`));
    // Popular packages' upgrade pages (src/mcp/publicUpgrades.ts): a few
    // unextracted sides, queued only while the queue has headroom, so this can
    // never delay the demand-driven misses drained just below.
    await (async () => {
      const handle = createDb({ max: 2 });
      try {
        const { enqueuePublicUpgrades } = await import('../mcp/publicUpgrades');
        const queued = await enqueuePublicUpgrades(handle.db);
        if (queued) logger.info(`worker: queued ${queued} surface(s) for public upgrade pages`);
      } finally {
        await handle.close();
      }
    })().catch((err) => logger.warn(`worker: upgrade page queue failed: ${String(err)}`));
    // Service surface-extraction misses (v1 §6.1). Query misses are revealed
    // demand and rank highest, so this runs every cycle; without it
    // resolve_surface answers UNKNOWN forever and the queue only grows.
    await (async () => {
      const handle = createDb({ max: 4 });
      try {
        const s = await drainSurfaceQueue(handle.db, { limit: surfacePerCycle });
        if (s.drained) {
          logger.info(
            `worker: surface drain, ${s.stored} stored, ${s.cached} cached, ${s.undeclared} undeclared, ${s.backfilled} predecessor(s) queued, ${s.failed} failed`,
          );
        }
      } finally {
        await handle.close();
      }
    })().catch((err) => logger.warn(`worker: surface drain failed: ${String(err)}`));
    // Service MCP probe misses. Budgeted an order of magnitude lower than the
    // npm drain above because each item installs a package and handshakes with
    // someone else's program — seconds each, not milliseconds, and one hung
    // server must not be able to stall the cycle.
    await (async () => {
      const handle = createDb({ max: 4 });
      try {
        const s = await drainMcpQueue(handle.db, { limit: mcpPerCycle });
        if (s.drained) {
          logger.info(
            `worker: mcp drain, ${s.stored} stored, ${s.cached} cached, ${s.undeclared} undeclared, ${s.unreachable} unreachable, ${s.truncated} truncated, ${s.backfilled} predecessor(s) queued, ${s.failed} failed`,
          );
        }
      } finally {
        await handle.close();
      }
    })().catch((err) => logger.warn(`worker: mcp drain failed: ${String(err)}`));
    // The official MCP registry. Incremental against a watermark, so an hourly
    // pass reads a page or two; it runs before the remote drain so a server
    // published this hour is probed this hour.
    if (opts.registrySync !== false) {
      await (async () => {
        const { syncRegistry } = await import('../registry/sync');
        const handle = createDb({ max: 2 });
        try {
          const s = await syncRegistry(handle.db);
          if (s.versions) {
            logger.info(
              `worker: registry sync, ${s.versions} version(s), ${s.endpointsLinked} endpoint link(s), ${s.linksRemoved} link(s) removed, ${s.endpointsRemoved} endpoint(s) removed`,
            );
          }
        } finally {
          await handle.close();
        }
      })().catch((err) => logger.warn(`worker: registry sync failed: ${String(err)}`));
    }
    // Remote MCP endpoints: a credential-free read of each one's contract and
    // sign-in path. Plain HTTP, so the budget is two orders of magnitude above
    // the sandboxed stdio drain, and it is still bounded per host.
    await (async () => {
      const { drainRemoteProbes, REMOTE_PROBES_PER_CYCLE } = await import('../remoteProbe/drain');
      const handle = createDb({ max: 4 });
      try {
        const s = await drainRemoteProbes(handle.db, {
          limit: opts.remoteProbesPerCycle ?? REMOTE_PROBES_PER_CYCLE,
        });
        if (s.claimed) {
          const statuses = Object.entries(s.byStatus)
            .map(([k, v]) => `${v} ${k}`)
            .join(', ');
          logger.info(
            `worker: remote probes, ${s.probed} probed (${statuses || 'none'}), ${s.changes} change(s), ${s.failed} failed`,
          );
        }
      } finally {
        await handle.close();
      }
    })().catch((err) => logger.warn(`worker: remote probe drain failed: ${String(err)}`));
    // Account email. Last in the cycle so it sees this cycle's alerts; hourly is
    // the ceiling on how late an urgent email can be. A no-op without Resend and
    // Clerk configured.
    await (async () => {
      const { notifyFromConfig } = await import('../notify/run');
      const handle = createDb({ max: 2 });
      try {
        const s = await notifyFromConfig(handle.db);
        if (s && (s.urgentSent || s.digestSent || s.failed || s.deferred)) {
          logger.info(
            `worker: email, ${s.urgentSent} urgent, ${s.digestSent} digest, ${s.retried} retried, ${s.failed} failed, ${s.skipped} skipped, ${s.deferred} deferred by the daily cap`,
          );
        }
      } finally {
        await handle.close();
      }
    })().catch((err) => logger.warn(`worker: email pass failed: ${String(err)}`));
    // Alert channels (Slack, Discord, Teams, webhooks). A no-op without LURQ_SECRETS_KEY.
    await (async () => {
      const { channelsFromConfig } = await import('../notify/channelRun');
      const handle = createDb({ max: 2 });
      try {
        const s = await channelsFromConfig(handle.db);
        if (s && (s.sent || s.failed || s.disabled)) {
          logger.info(
            `worker: channels, ${s.sent} sent, ${s.failed} failed, ${s.disabled} switched off, ${s.skipped} skipped`,
          );
        }
      } finally {
        await handle.close();
      }
    })().catch((err) => logger.warn(`worker: channel pass failed: ${String(err)}`));
    // Rescore is NOT run here. It was, every cycle, and it reported "0 changed"
    // every time — which is arithmetic, not luck.
    //
    // The only score input that moves without new data is maintenance recency,
    // and it ramps 100 -> 0 across (staleDays 730 - freshDays 30) = 700 days.
    // That is 0.143 points a day before maintenance's 0.35 share of health, so a
    // package needs on the order of ten days for time decay alone to shift its
    // integer health score by one. Running it hourly asked a question ~240 times
    // more often than the data can answer differently, and each pass dragged
    // ~10MB of score rows across the wire from an off-platform database.
    //
    // Scores still have to be refreshed — they just belong on the daily sync
    // cron, which is where the rest of the time-relative work already lives.
    // Anything event-driven (a re-sync, new field evidence) already rescores the
    // package it touched at ingest time.

    if (opts.once || stopped) break;
    await interruptibleSleep(intervalSec, () => stopped);
  } while (!stopped);

  logger.info(`worker: stopped after ${cycle} cycle(s).`);
}
