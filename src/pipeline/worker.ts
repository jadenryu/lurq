/**
 * Autonomous discovery worker (§4G). One bounded loop that grows the frontier so
 * packages + edges + surfaces compound without human curation:
 *
 *   drain queue → ingest → mine → extract → surface → rescore → sleep → repeat
 *
 * Discovery and asset-building are the *same crawl* (§4G) — no separate matrix
 * job. Ingest mines observed edges (§4B) as a side effect; this loop adds the
 * bounded surface-extraction (§4D) and freshness-rescore passes. Owner-run:
 * `lurq worker` starts it; SIGINT/SIGTERM stops it cleanly after the current
 * cycle. Every candidate still clears the quality gate before it's served.
 */
import { logger } from '../core/logger';
import { createDb } from '../db/client';
import { getPackagesMissingSurface } from '../db/apiSurfaces';
import { pMap } from '../core/concurrency';
import { runDiscovery } from './discovery';
import { drainCompatVerifyQueue } from './compat';
import { drainSurfaceQueue } from './surface';
import { runRescore } from './rescore';

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
  /** Run exactly one cycle and return (for tests / cron). */
  once?: boolean;
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
      (p) => getOrExtractSurface(handle.db, p.name, p.version).then((s) => (s ? 1 : 0)),
      4,
    );
    const extracted = results.reduce((a: number, b) => a + b, 0);
    logger.info(`worker: extracted ${extracted}/${missing.length} API surfaces`);
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
    // Service surface-extraction misses (v1 §6.1). Query misses are revealed
    // demand and rank highest, so this runs every cycle; without it
    // resolve_surface answers UNKNOWN forever and the queue only grows.
    await (async () => {
      const handle = createDb({ max: 4 });
      try {
        const s = await drainSurfaceQueue(handle.db, { limit: surfacePerCycle });
        if (s.drained) {
          logger.info(
            `worker: surface drain, ${s.stored} stored, ${s.cached} cached, ${s.undeclared} undeclared, ${s.failed} failed`,
          );
        }
      } finally {
        await handle.close();
      }
    })().catch((err) => logger.warn(`worker: surface drain failed: ${String(err)}`));
    // Freshness of scores is a cheap rescore (§4G) — no re-fetch.
    await runRescore().catch((err) => logger.warn(`worker: rescore failed: ${String(err)}`));

    if (opts.once || stopped) break;
    await interruptibleSleep(intervalSec, () => stopped);
  } while (!stopped);

  logger.info(`worker: stopped after ${cycle} cycle(s).`);
}
