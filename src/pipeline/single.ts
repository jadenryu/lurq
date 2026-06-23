/**
 * Single-package ingestion + the on-demand path (§12.5). When a queried package
 * isn't tracked but exists on npm, lurq fetches, scores, embeds, stores, and
 * returns it — organically growing coverage beyond the seed list.
 */
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { getConfig } from '../core/config';
import type { Category, ScoreBreakdown } from '../core/types';
import { collectSignals } from '../ingestion/collect';
import { fetchWeeklyDownloads, npmPackageExists } from '../ingestion/sources';
import { buildSummaryInput, createSummaryProvider } from '../ingestion/summarize';
import {
  computeAdoption,
  computeConfidence,
  computeEfficiency,
  computeHealthScore,
  computeMaintenance,
  computeReliability,
  toScoringInput,
} from '../scoring';
import { buildEmbeddingText, createEmbeddingProvider } from '../search/embeddings';
import type { Database } from '../db/client';
import { ensureSeedEntry, getPackageByName, upsertPackage } from '../db/packages';
import { packages, seedPackages, type PackageRow } from '../db/schema';
import { assemblePackageRow } from './sync';

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
  const category =
    opts.category ?? existing?.category ?? (await getSeedCategory(db, name)) ?? null;

  const prefetchedWeekly = await fetchWeeklyDownloads(name).catch(() => null);
  const signals = await collectSignals(name, category, {
    githubToken: config.GITHUB_TOKEN,
    prefetchedWeekly,
  });

  const input = toScoringInput(signals, category);
  const summaryInput = await buildSummaryInput(signals, category);
  const { summary, usageGuide } = await createSummaryProvider().generate(summaryInput);

  const median = category ? await getCategoryMedianBundle(db, category) : null;
  const breakdown: ScoreBreakdown = {
    maintenance: computeMaintenance(input, now),
    adoption: computeAdoption(input),
    reliability: computeReliability(input),
    efficiency: computeEfficiency(input.bundleMinGzipKb, category, median),
  };
  const healthScore = computeHealthScore(breakdown);
  const confidence = computeConfidence(input, now);

  const [embedding] = await createEmbeddingProvider().embed([
    buildEmbeddingText({ name, category, summary, description: signals.registry?.description ?? null }),
  ]);

  await upsertPackage(
    db,
    assemblePackageRow({
      name,
      category,
      signals,
      input,
      summary,
      usageGuide,
      confidence,
      breakdown,
      healthScore,
      embedding: embedding ?? null,
      now,
    }),
  );
  return (await getPackageByName(db, name))!;
}

export interface GetOrFetchResult {
  row: PackageRow | null;
  /** True if the package was already in the index before this call. */
  wasTracked: boolean;
  existsOnNpm: boolean;
}

/**
 * Return a tracked package, or fetch+store it on demand if it's a real npm
 * package not yet in the index (§12.5). Returns row=null when it doesn't exist.
 */
export async function getOrFetchPackage(db: Database, name: string): Promise<GetOrFetchResult> {
  const existing = await getPackageByName(db, name);
  if (existing) return { row: existing, wasTracked: true, existsOnNpm: true };

  const exists = await npmPackageExists(name);
  if (!exists) return { row: null, wasTracked: false, existsOnNpm: false };

  const row = await syncOnePackage(db, name);
  // Persist the discovery into the seed list so future syncs keep it fresh.
  await ensureSeedEntry(db, name, row.category);
  return { row, wasTracked: false, existsOnNpm: true };
}
