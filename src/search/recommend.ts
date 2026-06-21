/**
 * Semantic recommendation (§11). Embeds the need, runs a pgvector cosine search
 * (optionally pre-filtered by inferred category + constraints), then re-ranks by
 * a blend of similarity and health score.
 */
import { and, cosineDistance, desc, eq, isNotNull, lte, sql } from 'drizzle-orm';
import type { Candidate, Category, Confidence, Runtime } from '../core/types';
import type { Database } from '../db/client';
import { packages } from '../db/schema';
import { inferCategory } from './categoryInference';
import { createEmbeddingProvider, type EmbeddingProvider } from './embeddings';

export interface RecommendConstraints {
  runtime?: Runtime;
  license?: string;
  maxBundleKb?: number;
  minConfidence?: Confidence;
}

export interface RecommendOptions {
  need: string;
  category?: Category;
  constraints?: RecommendConstraints;
  limit?: number;
}

const CONFIDENCE_RANK: Record<Confidence, number> = { unproven: 0, emerging: 1, proven: 2 };
/** Similarity vs health blend (§11). */
const SIM_WEIGHT = 0.6;
const HEALTH_WEIGHT = 0.4;

interface Row {
  name: string;
  category: Category | null;
  healthScore: number | null;
  confidence: Confidence | null;
  latestVersion: string | null;
  weeklyDownloads: number | null;
  lastReleaseAt: Date | null;
  repoUrl: string | null;
  similarity: number;
}

export async function recommend(
  db: Database,
  opts: RecommendOptions,
  provider: EmbeddingProvider = createEmbeddingProvider(),
): Promise<Candidate[]> {
  const limit = Math.min(Math.max(opts.limit ?? 3, 1), 5);
  const [queryVec] = await provider.embed([opts.need]);
  if (!queryVec) return [];

  const category = opts.category ?? inferCategory(opts.need);
  const pool = Math.max(limit * 5, 25);

  // Primary search (category-filtered when we have one).
  let rows = await runQuery(db, queryVec, opts.constraints, category, pool);
  // If a category filter starved the results, broaden to all categories.
  if (category && rows.length < limit) {
    const broad = await runQuery(db, queryVec, opts.constraints, null, pool);
    const seen = new Set(rows.map((r) => r.name));
    rows = rows.concat(broad.filter((r) => !seen.has(r.name)));
  }
  if (rows.length === 0) return [];

  // Re-rank: blend normalized cosine similarity with health (§11). We map cosine
  // [-1,1] → [0,1] with a fixed transform rather than pool min-max — min-max
  // over-amplifies the single closest match, letting one noisy embedding hit
  // outrank a much healthier package. Fixed normalization keeps health meaningful.
  const ranked = rows
    .map((r) => {
      const simNorm = Math.max(0, Math.min(1, (r.similarity + 1) / 2));
      const health = (r.healthScore ?? 0) / 100;
      return { row: r, score: SIM_WEIGHT * simNorm + HEALTH_WEIGHT * health };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return ranked.map(({ row }) => toCandidate(row));
}

async function runQuery(
  db: Database,
  queryVec: number[],
  constraints: RecommendConstraints | undefined,
  category: Category | null,
  pool: number,
): Promise<Row[]> {
  const similarity = sql<number>`1 - (${cosineDistance(packages.embedding, queryVec)})`;
  const conditions = [isNotNull(packages.embedding)];

  if (category) conditions.push(eq(packages.category, category));
  if (constraints?.license) conditions.push(eq(packages.license, constraints.license));
  if (constraints?.maxBundleKb !== undefined) {
    conditions.push(lte(packages.bundleMinGzipKb, constraints.maxBundleKb));
  }
  if (constraints?.minConfidence) {
    const allowed = (['proven', 'emerging', 'unproven'] as Confidence[]).filter(
      (c) => CONFIDENCE_RANK[c] >= CONFIDENCE_RANK[constraints.minConfidence!],
    );
    conditions.push(
      sql`${packages.confidence} in ${sql.raw(`(${allowed.map((c) => `'${c}'`).join(',')})`)}`,
    );
  }

  return db
    .select({
      name: packages.name,
      category: packages.category,
      healthScore: packages.healthScore,
      confidence: packages.confidence,
      latestVersion: packages.latestVersion,
      weeklyDownloads: packages.weeklyDownloads,
      lastReleaseAt: packages.lastReleaseAt,
      repoUrl: packages.repoUrl,
      similarity,
    })
    .from(packages)
    .where(and(...conditions))
    .orderBy(desc(similarity))
    .limit(pool);
}

function toCandidate(row: Row): Candidate {
  return {
    name: row.name,
    category: row.category,
    healthScore: row.healthScore ?? 0,
    confidence: row.confidence ?? 'unproven',
    why: buildWhy(row),
    latestVersion: row.latestVersion,
    weeklyDownloads: row.weeklyDownloads,
    lastReleaseAt: row.lastReleaseAt ? row.lastReleaseAt.toISOString() : null,
    repoUrl: row.repoUrl,
  };
}

/** A ≤1-sentence rationale (§12.3.1). */
function buildWhy(row: Row): string {
  const parts: string[] = [];
  if (row.confidence) parts.push(row.confidence);
  if (row.weeklyDownloads) parts.push(`${formatDownloads(row.weeklyDownloads)} weekly downloads`);
  if (row.healthScore !== null) parts.push(`health ${row.healthScore}`);
  return parts.join(', ') || 'tracked package';
}

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}
