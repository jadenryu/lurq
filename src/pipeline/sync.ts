/**
 * `lurq sync` pipeline (§9.7). End-to-end ingestion for the seed list (or one
 * package): collect signals → score → summarize → upsert, recording a sync_runs
 * row. Idempotent, concurrent, and tolerant of individual source failures (§17).
 *
 * Two-pass for efficiency (§10): pass 1 collects + scores everything that's
 * per-package; then category medians are computed; pass 2 finalizes efficiency
 * and the composite health score. Embeddings are added in M4.
 */
import { getConfig } from '../core/config';
import { pMap } from '../core/concurrency';
import { setCacheBypassRead } from '../core/http';
import { logger } from '../core/logger';
import type { Category, ScoreBreakdown } from '../core/types';
import { collectSignals } from '../ingestion/collect';
import { fetchBulkWeeklyDownloads } from '../ingestion/sources/npmDownloads';
import { buildSummaryInput, createSummaryProvider } from '../ingestion/summarize';
import type { RawPackageSignals } from '../ingestion/types';
import {
  computeAdoption,
  computeConfidence,
  computeEfficiency,
  computeHealthScore,
  computeMaintenance,
  computeReliability,
  median,
  toScoringInput,
  type ScoringInput,
} from '../scoring';
import { createDb, type Database } from '../db/client';
import {
  finishSyncRun,
  getSeedTargets,
  startSyncRun,
  upsertPackage,
} from '../db/packages';
import { isFrontendCategory } from '../core/types';
import type { NewPackageRow, SyncError } from '../db/schema';

export interface SyncOptions {
  full?: boolean;
  packageName?: string;
}

export interface SyncSummary {
  seen: number;
  updated: number;
  errors: number;
  status: 'success' | 'partial' | 'failed';
}

interface Target {
  name: string;
  category: Category | null;
}

/** Per-package state carried from pass 1 to pass 2. */
interface Computed {
  target: Target;
  signals: RawPackageSignals;
  input: ScoringInput;
  maintenance: number;
  adoption: number;
  reliability: number;
  confidence: ReturnType<typeof computeConfidence>;
  summary: string | null;
  usageGuide: NewPackageRow['usageGuide'];
}

export async function runSync(opts: SyncOptions = {}): Promise<SyncSummary> {
  const config = getConfig();
  const now = new Date();
  if (opts.full) setCacheBypassRead(true);

  const handle = createDb({ max: Math.max(4, config.LURQ_SYNC_CONCURRENCY) });
  const provider = createSummaryProvider();
  logger.info(`Summary provider: ${provider.kind}`);

  const runId = await startSyncRun(handle.db);
  const allErrors: SyncError[] = [];

  try {
    const targets = await resolveTargets(handle.db, opts);
    logger.info(`Syncing ${targets.length} package(s) with concurrency ${config.LURQ_SYNC_CONCURRENCY}…`);

    // Bulk-fetch weekly downloads up front (one call per 128 packages) to avoid
    // the downloads API rate limit that per-package bursts trigger.
    logger.info('Fetching weekly downloads in bulk…');
    const weeklyMap = await fetchBulkWeeklyDownloads(targets.map((t) => t.name));

    // ── Pass 1: collect + per-package scoring + summary ──────────────────────
    let done = 0;
    const computed = await pMap(
      targets,
      async (target): Promise<Computed | null> => {
        try {
          const signals = await collectSignals(target.name, target.category, {
            githubToken: config.GITHUB_TOKEN,
            prefetchedWeekly: weeklyMap.has(target.name) ? weeklyMap.get(target.name)! : undefined,
          });
          for (const e of signals.errors) allErrors.push({ package: target.name, ...e });

          const input = toScoringInput(signals, target.category);
          const summaryInput = await buildSummaryInput(signals, target.category);
          const { summary, usageGuide } = await provider.generate(summaryInput);

          if (++done % 25 === 0) logger.info(`  …${done}/${targets.length}`);
          return {
            target,
            signals,
            input,
            maintenance: computeMaintenance(input, now),
            adoption: computeAdoption(input),
            reliability: computeReliability(input),
            confidence: computeConfidence(input, now),
            summary,
            usageGuide,
          };
        } catch (err) {
          allErrors.push({
            package: target.name,
            source: 'pipeline',
            message: err instanceof Error ? err.message : String(err),
          });
          return null;
        }
      },
      config.LURQ_SYNC_CONCURRENCY,
    );

    const ok = computed.filter((c): c is Computed => c !== null);

    // ── Category medians for efficiency (§10) ────────────────────────────────
    const medians = computeCategoryMedians(ok);

    // ── Pass 2: efficiency + composite + upsert ──────────────────────────────
    let updated = 0;
    for (const c of ok) {
      const efficiency = computeEfficiency(
        c.input.bundleMinGzipKb,
        c.target.category,
        c.target.category ? (medians.get(c.target.category) ?? null) : null,
      );
      const breakdown: ScoreBreakdown = {
        maintenance: c.maintenance,
        adoption: c.adoption,
        reliability: c.reliability,
        efficiency,
      };
      const healthScore = computeHealthScore(breakdown);
      await upsertPackage(handle.db, buildRow(c, breakdown, healthScore, now));
      updated++;
    }

    const status: SyncSummary['status'] =
      updated === 0 ? 'failed' : allErrors.length > 0 ? 'partial' : 'success';
    await finishSyncRun(handle.db, runId, {
      packagesSeen: targets.length,
      packagesUpdated: updated,
      errors: allErrors,
      status,
    });

    logger.info(`Sync ${status}: ${updated}/${targets.length} updated, ${allErrors.length} source errors.`);
    return { seen: targets.length, updated, errors: allErrors.length, status };
  } catch (err) {
    await finishSyncRun(handle.db, runId, {
      packagesSeen: 0,
      packagesUpdated: 0,
      errors: [{ package: '*', source: 'pipeline', message: (err as Error).message }],
      status: 'failed',
    });
    throw err;
  } finally {
    if (opts.full) setCacheBypassRead(false);
    await handle.close();
  }
}

async function resolveTargets(db: Database, opts: SyncOptions): Promise<Target[]> {
  if (opts.packageName) {
    const seeds = await getSeedTargets(db);
    const found = seeds.find((s) => s.name === opts.packageName);
    return [{ name: opts.packageName, category: found?.category ?? null }];
  }
  return getSeedTargets(db);
}

function computeCategoryMedians(computed: Computed[]): Map<Category, number> {
  const byCategory = new Map<Category, number[]>();
  for (const c of computed) {
    const cat = c.target.category;
    const kb = c.input.bundleMinGzipKb;
    if (cat && isFrontendCategory(cat) && kb !== null) {
      const list = byCategory.get(cat) ?? [];
      list.push(kb);
      byCategory.set(cat, list);
    }
  }
  const medians = new Map<Category, number>();
  for (const [cat, list] of byCategory) {
    const m = median(list);
    if (m !== null) medians.set(cat, m);
  }
  return medians;
}

function buildRow(
  c: Computed,
  breakdown: ScoreBreakdown,
  healthScore: number,
  now: Date,
): NewPackageRow {
  const { signals, input, target } = c;
  const r = signals.registry;
  return {
    name: target.name,
    ecosystem: 'npm',
    category: target.category,
    description: r?.description ?? null,
    summary: c.summary,
    repoUrl: r?.repoUrl ?? null,
    homepage: r?.homepage ?? null,
    latestVersion: r?.latestVersion ?? null,
    license: r?.license ?? null,
    deprecated: input.deprecated,
    archived: input.archived,
    firstPublishedAt: input.firstPublishedAt,
    lastReleaseAt: input.lastReleaseAt,
    weeklyDownloads: input.weeklyDownloads,
    downloadGrowth90d: input.downloadGrowth90d,
    dependentsCount: input.dependentsCount,
    stars: input.stars,
    openIssues: input.openIssues,
    closedIssues: input.closedIssues,
    scorecard: input.scorecard,
    bundleMinGzipKb: input.bundleMinGzipKb,
    advisories: input.advisories,
    healthScore,
    confidence: c.confidence,
    scoreBreakdown: breakdown,
    usageGuide: c.usageGuide,
    dataAsOf: now,
  };
}
