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
import { formatError } from '../core/errors';
import { setCacheBypassRead } from '../core/http';
import { logger } from '../core/logger';
import { classifyRuntimeTarget } from '../core/runtimeTarget';
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
  getAllPackageNames,
  getSeedTargets,
  getStaleRefreshTargets,
  latestVersionsFor,
  startSyncRun,
  upsertPackage,
  upsertPackageVersions,
} from '../db/packages';
import { emitPublishAlerts } from '../github/alerts';
import { mineEdgesForPackage, remineAllClosures } from './mineEdges';
import { isFrontendCategory } from '../core/types';
import type { NewPackageRow, SyncError } from '../db/schema';

export interface SyncOptions {
  full?: boolean;
  packageName?: string;
}

/** Post-sync edge mining concurrency. Kept at 1 so fat dependency trees cannot
 *  spike heap the way concurrent mega-upserts did on the Railway sync cron. */
export const SYNC_MINE_CONCURRENCY = 1;

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
  if (!config.GITHUB_TOKEN) {
    logger.warn(
      'GITHUB_TOKEN not set, GitHub signals (stars, issues, release cadence) will be ' +
        'skipped, degrading maintenance/adoption scores. Set it for accurate scoring.',
    );
  }

  const runId = await startSyncRun(handle.db);
  const allErrors: SyncError[] = [];

  try {
    const targets = await resolveTargets(handle.db, opts, config.LURQ_SYNC_REFRESH_CAP);
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
    //
    // Snapshot what the index currently calls `latest` before the upsert below
    // overwrites it. That "before" is the only way to tell a re-sync of a known
    // version from a package that has just shipped a new major, which is what
    // `emitPublishAlerts` notifies connected repos about. One query for the whole
    // pass, and it must be read *before* the loop, not inside it.
    const priorLatest = await latestVersionsFor(handle.db, ok.map((c) => c.target.name));
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
          embeddingProvider: embProvider.id,
          now,
        }),
      );
      // Record the version timeline. The on-demand path (pipeline/single.ts)
      // has always done this; the sync pass never did, so every package whose
      // only route into the index is the nightly cron — which is the entire
      // seed list — had a package row and no history behind it. Measured on
      // production before this line existed: 220 tracked packages with zero
      // versions, including react, chalk, commander, lodash, eslint and
      // esbuild, and 15 of the 100 most-installed packages in the index.
      //
      // Everything version-shaped reads that table, so the absence was not
      // quiet: the drift board's "N% of packages have broken" is computed over
      // a set that could not contain them, and `compat`, `usage` and the whole
      // upgrade path have nothing to say about a package with no timeline.
      //
      // Failure is logged rather than swallowed. single.ts catches this into a
      // bare `() => {}` — right that a history write must not fail a sync,
      // wrong that it should do so in silence, which is the other half of why
      // this went unnoticed.
      await upsertPackageVersions(
        handle.db,
        c.target.name,
        c.signals.registry?.versionTimeline ?? [],
      ).catch((err: unknown) => {
        logger.warn(`version timeline write failed for ${c.target.name}: ${String(err)}`);
      });
      // Tell the repos that depend on this package if the release it just picked
      // up is a new major. Cheap by construction: this returns immediately unless
      // the major actually moved, so a sync of 5,000 unchanged packages costs 5,000
      // version comparisons and no queries.
      await emitPublishAlerts(
        handle.db,
        c.target.name,
        { latestVersion: priorLatest.get(c.target.name) ?? null },
        { latestVersion: c.signals.registry?.latestVersion ?? null },
      );
      updated++;
    }

    // ── Mine observed compat edges (§4B) ─────────────────────────────────────
    // Every ingested package's resolved closure is a co-installation witness;
    // mint free `observed` edges among its tracked nodes. Tracked set loaded once
    // (§4B step 2). Best-effort; concurrency 1 caps peak memory for fat trees
    // (ingest above stays concurrent).
    const tracked = new Set(await getAllPackageNames(handle.db));
    await pMap(
      ok,
      (c) => mineEdgesForPackage(handle.db, c.target.name, c.signals.registry?.latestVersion ?? null, tracked, now),
      SYNC_MINE_CONCURRENCY,
    );
    // Trigger 2 (§4B): a full sync is the daily cron — re-mine every persisted
    // closure against the *current* tracked set (no network) so packages tracked
    // since the closure was captured get fully linked within 24h. Best-effort.
    if (!opts.packageName) {
      await remineAllClosures(handle.db).catch((err) =>
        logger.warn(`re-mine pass failed: ${formatError(err)}`),
      );
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

/**
 * Seeds every run, plus a rotation of the stalest discovered packages. Seeds are
 * ~9% of the index; syncing only those left the other ~91% frozen at their
 * ingest date (and, via `latest_version`, stalled discovery — see
 * `getStaleRefreshTargets`).
 */
async function resolveTargets(
  db: Database,
  opts: SyncOptions,
  refreshCap: number,
): Promise<Target[]> {
  const seeds = await getSeedTargets(db);
  if (opts.packageName) {
    const found = seeds.find((s) => s.name === opts.packageName);
    return [{ name: opts.packageName, category: found?.category ?? null }];
  }
  const refresh = await getStaleRefreshTargets(db, refreshCap);
  logger.info(`Targets: ${seeds.length} seed(s) + ${refresh.length} stale refresh(es).`);
  return [...seeds, ...refresh];
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
  embeddingProvider: string | null;
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
    stars: p.input.stars,
    openIssues: p.input.openIssues,
    closedIssues: p.input.closedIssues,
    scorecard: p.input.scorecard,
    bundleMinGzipKb: p.input.bundleMinGzipKb,
    advisories: p.input.advisories,
    peerDependencies: r?.peerDependencies ?? null,
    peerDependenciesMeta: r?.peerDependenciesMeta ?? null,
    engines: r?.engines ?? null,
    runtimeTarget: r
      ? classifyRuntimeTarget({
          name: p.name,
          hasBrowserField: r.hasBrowserField,
          keywords: r.keywords,
          engines: r.engines,
          peerDependencies: r.peerDependencies,
        })
      : null,
    healthScore: p.healthScore,
    qualityScore: p.qualityScore,
    confidence: p.confidence,
    scoreBreakdown: p.breakdown,
    usageGuide: p.usageGuide,
    embedding: p.embedding,
    embeddingProvider: p.embedding ? p.embeddingProvider : null,
    dataAsOf: p.now,
  };
}
