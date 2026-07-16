/**
 * Single-package ingestion + the on-demand path (§12.5). When a queried package
 * isn't tracked but exists on npm, lurq fetches, scores, embeds, stores, and
 * returns it — organically growing coverage beyond the seed list.
 */
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { getConfig } from '../core/config';
import type { Category, CategorySource, ScoreBreakdown } from '../core/types';
import { collectSignals } from '../ingestion/collect';
import { fetchWeeklyDownloads, npmPackageExists } from '../ingestion/sources';
import { buildSummaryInput, createSummaryProvider } from '../ingestion/summarize';
import { inferCategoryFromSignals } from '../search/categoryInference';
import {
  computeAdoption,
  computeConfidence,
  computeEfficiency,
  computeHealthScore,
  computeMaintenance,
  computeQuality,
  computeReliability,
  toScoringInput,
} from '../scoring';
import { buildEmbeddingText, createEmbeddingProvider } from '../search/embeddings';
import type { Database } from '../db/client';
import {
  getPackageByName,
  upsertPackage,
  upsertPackageVersions,
} from '../db/packages';
import { packages, seedPackages, type PackageRow } from '../db/schema';
import { assemblePackageRow } from './sync';
import { mineEdgesForPackage } from './mineEdges';
// Safe module cycle: ingestQueue imports syncOnePackage from here, but both
// bindings are used only at call time, never at module-eval, so ESM resolves it.
import { enqueueIngest, runIngest } from './ingestQueue';

/** Block-on-first-touch budget for single-package tools (§4A). Past this the
 *  in-flight ingest keeps running in the background and the caller gets the
 *  "retry shortly" hint instead of a stalled request. */
export const FIRST_TOUCH_BUDGET_MS = 4000;

function raceTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

async function getSeedCategory(db: Database, name: string): Promise<Category | null> {
  const [row] = await db
    .select({ category: seedPackages.category })
    .from(seedPackages)
    .where(eq(seedPackages.name, name))
    .limit(1);
  return row?.category ?? null;
}

/** Median bundle size across already-tracked packages in a category (for efficiency). */
async function getCategoryMedianBundle(db: Database, category: Category): Promise<number | null> {
  const [row] = await db
    .select({
      m: sql<number | null>`percentile_cont(0.5) within group (order by ${packages.bundleMinGzipKb})`,
    })
    .from(packages)
    .where(and(eq(packages.category, category), isNotNull(packages.bundleMinGzipKb)));
  return row?.m ?? null;
}

/** Fetch, score, embed, and upsert a single package; returns the stored row. */
export async function syncOnePackage(
  db: Database,
  name: string,
  opts: { category?: Category | null } = {},
): Promise<PackageRow> {
  const config = getConfig();
  const now = new Date();

  const existing = await getPackageByName(db, name);
  // The curated category (from a manual arg or the seed list) wins. We resolve
  // the final category *after* ingest so a discovered package can be classified
  // from its own text rather than stored as a second-class `null` (§2A).
  const curatedCategory = opts.category ?? (await getSeedCategory(db, name)) ?? null;
  const initialCategory = curatedCategory ?? existing?.category ?? null;

  const prefetchedWeekly = await fetchWeeklyDownloads(name).catch(() => null);
  const signals = await collectSignals(name, initialCategory, {
    githubToken: config.GITHUB_TOKEN,
    prefetchedWeekly,
  });

  const summaryInput = await buildSummaryInput(signals, initialCategory);
  const { summary, usageGuide, inferredCategory } =
    await createSummaryProvider().generate(summaryInput);

  let category: Category | null;
  let categorySource: CategorySource | null;
  if (curatedCategory) {
    category = curatedCategory;
    categorySource = 'curated';
  } else if (existing?.category) {
    category = existing.category;
    categorySource = existing.categorySource ?? 'inferred';
  } else {
    category = inferCategoryFromSignals(signals) ?? inferredCategory ?? null;
    categorySource = category ? 'inferred' : null;
  }

  const input = toScoringInput(signals, category);

  const median = category ? await getCategoryMedianBundle(db, category) : null;
  const quality = computeQuality(input);
  const breakdown: ScoreBreakdown = {
    maintenance: computeMaintenance(input, now),
    adoption: computeAdoption(input),
    reliability: computeReliability(input),
    efficiency: computeEfficiency(input.bundleMinGzipKb, category, median),
    quality,
  };
  const healthScore = computeHealthScore(breakdown);
  const confidence = computeConfidence(input, now, quality);

  const embProvider = createEmbeddingProvider();
  const [embedding] = await embProvider.embed([
    buildEmbeddingText({ name, category, summary, description: signals.registry?.description ?? null }),
  ]);

  await upsertPackage(
    db,
    assemblePackageRow({
      name,
      category,
      categorySource,
      signals,
      input,
      summary,
      usageGuide,
      confidence,
      breakdown,
      healthScore,
      qualityScore: quality,
      embedding: embedding ?? null,
      embeddingProvider: embProvider.id,
      now,
    }),
  );
  // Record the version timeline (idempotent). Non-fatal: never block a
  // successful package upsert on the version-history write.
  await upsertPackageVersions(db, name, signals.registry?.versionTimeline ?? []).catch(
    () => {},
  );
  // Mint observed compat edges from this package's resolved closure (§4B
  // Trigger 1). Best-effort — mineEdgesForPackage swallows its own errors.
  await mineEdgesForPackage(db, name, signals.registry?.latestVersion ?? null, undefined, now);
  return (await getPackageByName(db, name))!;
}

export interface GetOrFetchResult {
  row: PackageRow | null;
  /** True if the package was already in the index before this call. */
  wasTracked: boolean;
  existsOnNpm: boolean;
  /** True if a real-but-untracked package was scheduled for background
   *  ingestion this call — the caller should tell the agent to retry shortly. */
  queued?: boolean;
}

/**
 * Return a tracked package, or — if it's a real npm package not yet in the index
 * (§12.5) — fetch it. Two modes:
 *
 * - Default (async): schedule background ingestion and return row=null so a
 *   multi-package fan-out never blocks on one slow package.
 * - `blockMs` set (§4A block-on-first-touch): await the ingest up to a budget
 *   and return the real row on the *first* call. On timeout the ingest keeps
 *   running in the background and the caller gets the "retry shortly" hint.
 *
 * Returns existsOnNpm=false when the name isn't a real package at all.
 */
export async function getOrFetchPackage(
  db: Database,
  name: string,
  opts: { blockMs?: number } = {},
): Promise<GetOrFetchResult> {
  const existing = await getPackageByName(db, name);
  if (existing) return { row: existing, wasTracked: true, existsOnNpm: true };

  const exists = await npmPackageExists(name);
  if (!exists) return { row: null, wasTracked: false, existsOnNpm: false };

  if (opts.blockMs && opts.blockMs > 0) {
    // Single-package tools await the ingest so the first call returns a real row
    // instead of a placeholder that reads as failure. On timeout the started
    // ingest keeps running (not cancelled) and lands within a few more seconds.
    // ponytail: inline ingest isn't queue-bounded; single-package request rate
    // is the natural cap. Route through enqueueIngest if a flood ever appears.
    const row = await raceTimeout(runIngest(db, name), opts.blockMs);
    if (row) return { row, wasTracked: false, existsOnNpm: true };
    return { row: null, wasTracked: false, existsOnNpm: true, queued: true };
  }

  // Real but untracked: ingest off the request path. Bounded + deduped so a
  // flood of distinct names can't spawn unbounded work (the whole point of not
  // doing it inline). Roster promotion happens in the worker, same quality bar.
  enqueueIngest(db, name);
  return { row: null, wasTracked: false, existsOnNpm: true, queued: true };
}
