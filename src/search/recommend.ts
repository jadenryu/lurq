/**
 * Hybrid recommendation (§3, §11). Two retrievals run over the same candidate
 * table — vector cosine (semantic) and `tsvector` lexical (exact name/keyword) —
 * fused with Reciprocal Rank Fusion (RRF), then re-ranked by a blend of fused
 * relevance and the quality-aware composite (§1). Pure vector search misses
 * exact-name hits (especially the keyless local embedder); the lexical leg fixes
 * that, and RRF avoids having to normalize two incomparable score scales.
 */
import { and, cosineDistance, eq, isNotNull, lte, sql } from 'drizzle-orm';
import type { Candidate, Category, Confidence, Runtime } from '../core/types';
import type { Database } from '../db/client';
import { packages } from '../db/schema';
import { computeComposite } from '../scoring';
import { loadWeights } from '../scoring/weights';
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

const CONFIDENCE_RANK: Record<Confidence, number> = {
  unproven: 0,
  promising: 1,
  emerging: 2,
  proven: 3,
};
/** Fused-relevance vs composite blend (§3, §11). The second term is the
 *  quality-aware composite (§1), not raw health — so a well-built package isn't
 *  buried by a popularity-tilted score. */
const RELEVANCE_WEIGHT = 0.6;
const COMPOSITE_WEIGHT = 0.4;
/** RRF damping constant — standard value from the original RRF paper (§3). */
const RRF_K = 60;

interface Row {
  name: string;
  category: Category | null;
  healthScore: number | null;
  qualityScore: number | null;
  confidence: Confidence | null;
  latestVersion: string | null;
  weeklyDownloads: number | null;
  lastReleaseAt: Date | null;
  repoUrl: string | null;
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
  let fused = await hybridSearch(db, queryVec, provider.id, opts.need, opts.constraints, category, pool);
  // If a category filter starved the results, broaden to all categories.
  if (category && fused.length < limit) {
    const broad = await hybridSearch(db, queryVec, provider.id, opts.need, opts.constraints, null, pool);
    const seen = new Set(fused.map((f) => f.row.name));
    fused = fused.concat(broad.filter((f) => !seen.has(f.row.name)));
  }
  if (fused.length === 0) return [];

  // Re-rank: blend normalized fused relevance (RRF) with the quality-aware
  // composite (§1). RRF rank-fusion already absorbs both retrieval legs, so the
  // relevance term rewards exact lexical hits the vector leg alone would miss.
  const lambda = loadWeights().composite.lambda;
  const maxRrf = Math.max(...fused.map((f) => f.rrf));
  const ranked = fused
    .map((f) => {
      const relevance = maxRrf > 0 ? f.rrf / maxRrf : 0;
      const composite = computeComposite(f.row.healthScore ?? 0, f.row.qualityScore, lambda) / 100;
      return { row: f.row, score: RELEVANCE_WEIGHT * relevance + COMPOSITE_WEIGHT * composite };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return ranked.map(({ row }) => toCandidate(row));
}

interface Fused {
  row: Row;
  rrf: number;
}

/**
 * Run the vector and lexical retrievals and fuse them with RRF (§3). Each leg
 * independently ranks the candidate set; a doc's fused score is the sum of
 * 1/(k+rank) across the legs it appears in — so documents both legs agree on
 * rise, and exact-name hits the vector leg ranks poorly still surface.
 */
async function hybridSearch(
  db: Database,
  queryVec: number[],
  providerId: string,
  need: string,
  constraints: RecommendConstraints | undefined,
  category: Category | null,
  pool: number,
): Promise<Fused[]> {
  const [vectorRows, lexicalRows] = await Promise.all([
    runVectorQuery(db, queryVec, providerId, constraints, category, pool),
    runLexicalQuery(db, need, constraints, category, pool),
  ]);
  return rrfFuse([vectorRows, lexicalRows]);
}

/**
 * Reciprocal Rank Fusion over N ranked lists (§3). A document's fused score is
 * Σ 1/(k + rank) across the lists it appears in — using only ranks, never raw
 * scores, so two incomparable scales (cosine distance vs ts_rank) never need
 * normalizing. Generic over `{ name }` so the fusion math is unit-testable.
 */
export function rrfFuse<T extends { name: string }>(
  lists: T[][],
  k = RRF_K,
): { row: T; rrf: number }[] {
  const fused = new Map<string, { row: T; rrf: number }>();
  for (const list of lists) {
    list.forEach((row, idx) => {
      const contribution = 1 / (k + idx + 1); // rank is 1-based
      const prev = fused.get(row.name);
      if (prev) prev.rrf += contribution;
      else fused.set(row.name, { row, rrf: contribution });
    });
  }
  return [...fused.values()].sort((a, b) => b.rrf - a.rrf);
}

const ROW_COLUMNS = {
  name: packages.name,
  category: packages.category,
  healthScore: packages.healthScore,
  qualityScore: packages.qualityScore,
  confidence: packages.confidence,
  latestVersion: packages.latestVersion,
  weeklyDownloads: packages.weeklyDownloads,
  lastReleaseAt: packages.lastReleaseAt,
  repoUrl: packages.repoUrl,
} as const;

/** Shared filter conditions (category + constraints) for both retrieval legs. */
function buildConditions(
  constraints: RecommendConstraints | undefined,
  category: Category | null,
) {
  const conditions = [];
  if (category) conditions.push(eq(packages.category, category));
  if (constraints?.license) conditions.push(eq(packages.license, constraints.license));
  if (constraints?.maxBundleKb !== undefined) {
    conditions.push(lte(packages.bundleMinGzipKb, constraints.maxBundleKb));
  }
  if (constraints?.minConfidence) {
    const allowed = (['proven', 'emerging', 'promising', 'unproven'] as Confidence[]).filter(
      (c) => CONFIDENCE_RANK[c] >= CONFIDENCE_RANK[constraints.minConfidence!],
    );
    conditions.push(
      sql`${packages.confidence} in ${sql.raw(`(${allowed.map((c) => `'${c}'`).join(',')})`)}`,
    );
  }
  return conditions;
}

/** Semantic leg: pgvector cosine, ordered by ascending distance. */
async function runVectorQuery(
  db: Database,
  queryVec: number[],
  providerId: string,
  constraints: RecommendConstraints | undefined,
  category: Category | null,
  pool: number,
): Promise<Row[]> {
  const distance = cosineDistance(packages.embedding, queryVec);
  // Only compare vectors produced in the same space as the query vector. Rows
  // embedded by a different provider/model are excluded (they get retrieved by
  // the lexical leg instead) rather than compared across incompatible spaces.
  const conditions = [
    isNotNull(packages.embedding),
    eq(packages.embeddingProvider, providerId),
    ...buildConditions(constraints, category),
  ];
  return db
    .select(ROW_COLUMNS)
    .from(packages)
    .where(and(...conditions))
    .orderBy(distance)
    .limit(pool);
}

/** Lexical leg: full-text `tsvector` match, ranked by `ts_rank` (§3). */
async function runLexicalQuery(
  db: Database,
  need: string,
  constraints: RecommendConstraints | undefined,
  category: Category | null,
  pool: number,
): Promise<Row[]> {
  const tsquery = sql`websearch_to_tsquery('english', ${need})`;
  const rank = sql<number>`ts_rank(${packages.searchVector}, ${tsquery})`;
  const conditions = [sql`${packages.searchVector} @@ ${tsquery}`, ...buildConditions(constraints, category)];
  return db
    .select(ROW_COLUMNS)
    .from(packages)
    .where(and(...conditions))
    .orderBy(sql`${rank} desc`)
    .limit(pool);
}

function toCandidate(row: Row): Candidate {
  return {
    name: row.name,
    category: row.category,
    healthScore: row.healthScore ?? 0,
    qualityScore: row.qualityScore,
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
