/**
 * `lurq sync` pipeline (§9.7). End-to-end ingestion for the seed list (or one
 * package): collect signals → score → summarize → upsert, recording a sync_runs
 * row. Idempotent, concurrent, and tolerant of individual source failures (§17).
 *
 * Two-pass for efficiency (§10): pass 1 collects + scores everything that's
 * per-package; then category medians are computed; pass 2 finalizes efficiency
 * and the composite health score. Embeddings are added in M4.
 */
import { invalidateCache } from '../core/cache';
import { getConfig } from '../core/config';
import { pMap } from '../core/concurrency';
import { setCacheBypassRead } from '../core/http';
import { logger } from '../core/logger';
import type { Category, CategorySource, ScoreBreakdown } from '../core/types';
import { collectSignals } from '../ingestion/collect';
import { fetchBulkWeeklyDownloads } from '../ingestion/sources/npmDownloads';
import { buildSummaryInput, createSummaryProvider } from '../ingestion/summarize';
import { inferCategoryFromSignals } from '../search/categoryInference';
import { buildEmbeddingText, createEmbeddingProvider } from '../search/embeddings';
import type { RawPackageSignals } from '../ingestion/types';
import {
  computeAdoption,
  computeConfidence,
  computeEfficiency,
  computeHealthScore,
  computeMaintenance,
  computeQuality,
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
  /** Final resolved category (curated or inferred at ingest, §2A). */
  category: Category | null;
  categorySource: CategorySource | null;
  signals: RawPackageSignals;
  input: ScoringInput;
  maintenance: number;
  adoption: number;
  reliability: number;
  quality: number | null;
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

          const summaryInput = await buildSummaryInput(signals, target.category);
          const { summary, usageGuide, inferredCategory } = await provider.generate(summaryInput);

          // Categorize-on-ingest (§2A): curated category wins; otherwise infer
          // from the package's own text, then fall back to the LLM classifier.
          let category = target.category;
          let categorySource: CategorySource | null = target.category ? 'curated' : null;
          if (!category) {
            category = inferCategoryFromSignals(signals) ?? inferredCategory ?? null;
            categorySource = category ? 'inferred' : null;
          }

          const input = toScoringInput(signals, category);
          const quality = computeQuality(input);
          if (++done % 25 === 0) logger.info(`  …${done}/${targets.length}`);
          return {
            target,
            category,
            categorySource,
            signals,
            input,
            maintenance: computeMaintenance(input, now),
            adoption: computeAdoption(input),
            reliability: computeReliability(input),
            quality,
            confidence: computeConfidence(input, now, quality),
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

    // ── Embeddings (§11): embed the normalized text blob for each package ─────
    const embProvider = createEmbeddingProvider();
    logger.info(`Embedding provider: ${embProvider.kind}`);
    const embeddings = await embProvider.embed(
      ok.map((c) =>
        buildEmbeddingText({
          name: c.target.name,
          category: c.category,
          summary: c.summary,
          description: c.signals.registry?.description ?? null,
        }),
      ),
    );

    // ── Pass 2: efficiency + composite + upsert ──────────────────────────────
    let updated = 0;
    for (let i = 0; i < ok.length; i++) {
      const c = ok[i]!;
      const efficiency = computeEfficiency(
        c.input.bundleMinGzipKb,
        c.category,
        c.category ? (medians.get(c.category) ?? null) : null,
      );
      const breakdown: ScoreBreakdown = {
        maintenance: c.maintenance,
        adoption: c.adoption,
        reliability: c.reliability,
        efficiency,
        quality: c.quality,
      };
      const healthScore = computeHealthScore(breakdown);
      await upsertPackage(
        handle.db,
        assemblePackageRow({
          name: c.target.name,
          category: c.category,
          categorySource: c.categorySource,
          signals: c.signals,
          input: c.input,
          summary: c.summary,
          usageGuide: c.usageGuide,
          confidence: c.confidence,
          breakdown,
          healthScore,
          qualityScore: c.quality,
          embedding: embeddings[i] ?? null,
          now,
        }),
      );
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
    // The index changed — drop cached reads so the next query sees fresh scores.
    if (updated > 0) await invalidateCache();
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
    const cat = c.category;
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

/** Assemble a fully-scored package row. Shared by the bulk sync and the
 *  on-demand single-package path (§12.5). */
export function assemblePackageRow(p: {
  name: string;
  category: Category | null;
  categorySource: CategorySource | null;
  signals: RawPackageSignals;
  input: ScoringInput;
  summary: string | null;
  usageGuide: NewPackageRow['usageGuide'];
  confidence: NewPackageRow['confidence'];
  breakdown: ScoreBreakdown;
  healthScore: number;
  qualityScore: number | null;
  embedding: number[] | null;
  now: Date;
}): NewPackageRow {
  const r = p.signals.registry;
  return {
    name: p.name,
    ecosystem: 'npm',
    category: p.category,
    categorySource: p.categorySource,
    description: r?.description ?? null,
    summary: p.summary,
    repoUrl: r?.repoUrl ?? null,
    homepage: r?.homepage ?? null,
    latestVersion: r?.latestVersion ?? null,
    license: r?.license ?? null,
    deprecated: p.input.deprecated,
    archived: p.input.archived,
    firstPublishedAt: p.input.firstPublishedAt,
    lastReleaseAt: p.input.lastReleaseAt,
    weeklyDownloads: p.input.weeklyDownloads,
    downloadGrowth90d: p.input.downloadGrowth90d,
    dependentsCount: p.input.dependentsCount,
    stars: p.input.stars,
    openIssues: p.input.openIssues,
    closedIssues: p.input.closedIssues,
    scorecard: p.input.scorecard,
    bundleMinGzipKb: p.input.bundleMinGzipKb,
    advisories: p.input.advisories,
    peerDependencies: r?.peerDependencies ?? null,
    peerDependenciesMeta: r?.peerDependenciesMeta ?? null,
    engines: r?.engines ?? null,
    healthScore: p.healthScore,
    qualityScore: p.qualityScore,
    confidence: p.confidence,
    scoreBreakdown: p.breakdown,
    usageGuide: p.usageGuide,
    embedding: p.embedding,
    dataAsOf: p.now,
  };
}
