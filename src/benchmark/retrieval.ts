/**
 * Retrieval eval: can `recommend` find a package when asked for what it does?
 *
 * WHY THIS SHAPE
 *
 * The obvious eval — a list of needs with hand-written "correct" packages —
 * is unusable here, for two reasons the author of that list cannot escape:
 *
 *   1. Whoever writes it encodes their own snapshot of the ecosystem. If a
 *      model writes it, the ground truth is frozen at a training cutoff, which
 *      is the exact failure lurq exists to remove. Tuning retrieval to agree
 *      with a stale opinion is worse than not measuring at all, because it
 *      looks like progress.
 *   2. Eighty hand-picked needs against 38k packages and 23 categories is a
 *      sample small enough to overfit in an afternoon.
 *
 * So nothing here is authored. A case is built by taking a package that people
 * demonstrably CHOOSE, rephrasing its own stored summary into the way a
 * developer would ask for it, and requiring retrieval to find its way back. The
 * answer key is the source package, by construction — there is no judgment
 * call about which library is "best", only a mechanical question: given a
 * description of what this package does, does the index return it?
 *
 * The model is used only to paraphrase. That is deliberate: bias in the QUERY
 * is phrasing, which models do well and which carries no package preference;
 * bias in the ANSWER is the stale judgment we are trying to eliminate.
 *
 * WHAT IT MEASURES
 *
 * recall@k is the headline, because recall is the actual defect. Measured on
 * the live index, `zod` — 274M weekly downloads, correct category — sat outside
 * the top FIFTY for "HTTP request validation" on both retrieval legs. A ranking
 * weight cannot rescue a candidate that was never fetched, which is why four
 * ranking-side fixes in a row measured flat or worse.
 *
 * MRR is reported alongside it, since among retrieved candidates position still
 * matters, but a change that moves MRR without moving recall is rearranging
 * results that were already there.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { packages } from '../db/schema';
import { getConfig } from '../core/config';
import { httpRequest } from '../core/http';
import { logger } from '../core/logger';
import { recommend } from '../search/recommend';
import type { Category } from '../core/types';

export interface RetrievalCase {
  /** The package the query was generated from — the answer, by construction. */
  target: string;
  category: Category;
  /** Use-case phrasing of the target's own summary. */
  query: string;
  /** Kept for auditing: what the query was generated from. */
  sourceSummary: string;
  directDependents: number;
  directShare: number;
}

export interface RetrievalResult {
  target: string;
  category: Category;
  query: string;
  /** 1-based position of the target, or null when it was never returned. */
  rank: number | null;
  returned: string[];
}

export interface RetrievalMetrics {
  cases: number;
  recallAt1: number;
  recallAt5: number;
  recallAt25: number;
  /** Mean reciprocal rank over all cases; a miss contributes 0. */
  mrr: number;
  byCategory: Record<string, { cases: number; recallAt25: number }>;
}

/**
 * Minimum direct dependents for a package to be worth a query.
 *
 * A retrieval system that reliably surfaces `@radix-ui/rect` is not better, it
 * is worse — nobody should ever be recommended a monorepo's internal utility.
 * Direct-share is what excludes those without excluding a small-but-real
 * library, since it measures whether anyone chose the package rather than how
 * many trees dragged it in.
 */
const MIN_DIRECT_DEPENDENTS = 25;
const MIN_DIRECT_SHARE = 0.15;

/**
 * Build cases by sampling packages people actually choose, stratified by
 * category so `utility` and `styling` — 13k of 38k rows — cannot dominate.
 */
export async function buildCases(
  db: Database,
  opts: { perCategory?: number; categories?: string[] } = {},
): Promise<RetrievalCase[]> {
  const perCategory = opts.perCategory ?? 17;
  const rows = await db.execute(sql`
    select name, category, summary, direct_dependents, indirect_dependents from (
      select name, category, summary, direct_dependents, indirect_dependents,
             row_number() over (
               partition by category
               order by direct_dependents desc nulls last
             ) rn
      from ${packages}
      where direct_dependents is not null
        and summary is not null
        and category is not null
        and deprecated = false
        and archived = false
        and direct_dependents >= ${MIN_DIRECT_DEPENDENTS}
        and direct_dependents::numeric
              / nullif(direct_dependents + indirect_dependents, 0) >= ${MIN_DIRECT_SHARE}
    ) ranked
    where rn <= ${perCategory}
  `);
  const list = ((rows as unknown as { rows?: any[] }).rows ?? (rows as unknown as any[])) ?? [];

  const cases: RetrievalCase[] = [];
  for (const r of list) {
    if (opts.categories && !opts.categories.includes(r.category)) continue;
    const query = await phraseAsNeed(r.name, r.summary);
    if (!query) continue;
    const total = Number(r.direct_dependents) + Number(r.indirect_dependents ?? 0);
    cases.push({
      target: r.name,
      category: r.category,
      query,
      sourceSummary: r.summary,
      directDependents: Number(r.direct_dependents),
      directShare: total > 0 ? Number(r.direct_dependents) / total : 0,
    });
  }
  return cases;
}

/**
 * Rewrite a package summary as the need a developer would type.
 *
 * The package name is passed only so it can be forbidden: a query containing
 * the answer measures string matching, not retrieval. Everything else about the
 * phrasing is the model's, and none of it encodes which package is correct.
 */
async function phraseAsNeed(name: string, summary: string): Promise<string | null> {
  const config = getConfig();
  if (config.SUMMARY_PROVIDER !== 'openai' || !config.SUMMARY_API_KEY) return null;
  const endpoint = `${config.SUMMARY_BASE_URL.replace(/\/$/, '')}/chat/completions`;
  try {
    const { data } = await httpRequest<{ choices: { message: { content: string } }[] }>(endpoint, {
      host: new URL(endpoint).host,
      method: 'POST',
      // Deterministic per package, so a re-run compares like with like rather
      // than re-rolling the query set and calling the difference a result.
      ttlMs: 90 * 24 * 60 * 60 * 1000,
      cacheKey: `need-phrase ${config.SUMMARY_MODEL} ${name}`,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.SUMMARY_API_KEY}` },
      body: JSON.stringify({
        model: config.SUMMARY_MODEL,
        temperature: 0,
        max_tokens: 40,
        messages: [{
          role: 'user',
          content:
            `Rewrite this package description as the short need a developer would type when looking for it ` +
            `(under 12 words, no package names, plain language). ` +
            `Never mention "${name}" or any other package name.\n\nDescription: ${summary}`,
        }],
      }),
    });
    const text = data?.choices?.[0]?.message?.content?.trim().replace(/^["']|["']$/g, '');
    if (!text) return null;
    // A query that leaked the answer measures nothing.
    if (text.toLowerCase().includes(name.toLowerCase())) return null;
    return text;
  } catch (err) {
    logger.warn(`retrieval-eval: phrasing failed for ${name} (${err instanceof Error ? err.message : String(err)})`);
    return null;
  }
}

/**
 * Freeze a case set to disk.
 *
 * Case selection depends on `direct_dependents`, which the backfill is still
 * filling — so two independently-built sets drawn minutes apart are NOT the
 * same experiment. The first paired comparison run this way reported a 7.4
 * point recall drop at p=0.375, which is incoherent: a drop that size implies
 * ~29 discordant pairs, and p=0.375 implies about five. The runs had simply
 * measured different packages.
 *
 * A paired test is only meaningful over identical cases, so the case set is
 * written once and replayed. `loadCases` is what every comparison should use.
 */
export function saveCases(path: string, cases: RetrievalCase[]): void {
  writeFileSync(path, JSON.stringify(cases, null, 2));
}

export function loadCases(path: string): RetrievalCase[] {
  return JSON.parse(readFileSync(path, 'utf8')) as RetrievalCase[];
}

/**
 * Refuse to compare two runs that did not measure the same thing.
 *
 * Silent partial overlap is the dangerous failure: unmatched targets are
 * skipped, the discordant count collapses, and every p-value comes back
 * reassuringly non-significant no matter how large the real effect.
 */
export function assertSameCases(a: RetrievalResult[], b: RetrievalResult[]): void {
  const sa = new Set(a.map((r) => r.target));
  const sb = new Set(b.map((r) => r.target));
  const shared = [...sa].filter((t) => sb.has(t)).length;
  const min = Math.min(sa.size, sb.size);
  if (shared < min) {
    throw new Error(
      `Case sets differ: ${shared} shared of ${sa.size}/${sb.size}. ` +
        `Re-run both sides with the same --cases file; a paired test over drifting cases is meaningless.`,
    );
  }
}

/** Run every case and record where the target landed. */
export async function runCases(
  db: Database,
  cases: RetrievalCase[],
  opts: { limit?: number; onProgress?: (n: number) => void } = {},
): Promise<RetrievalResult[]> {
  const limit = opts.limit ?? 25;
  const out: RetrievalResult[] = [];
  let n = 0;
  for (const c of cases) {
    const returned = (
      await recommend(db, { need: c.query, category: c.category, limit }).catch(() => [])
    ).map((r) => r.name);
    const idx = returned.indexOf(c.target);
    out.push({ target: c.target, category: c.category, query: c.query, rank: idx >= 0 ? idx + 1 : null, returned });
    opts.onProgress?.(++n);
  }
  return out;
}

export function computeMetrics(results: RetrievalResult[]): RetrievalMetrics {
  const n = results.length || 1;
  const hitsWithin = (k: number) => results.filter((r) => r.rank !== null && r.rank <= k).length / n;
  const byCategory: Record<string, { cases: number; recallAt25: number }> = {};
  for (const r of results) {
    const b = (byCategory[r.category] ??= { cases: 0, recallAt25: 0 });
    b.cases++;
    if (r.rank !== null) b.recallAt25++;
  }
  for (const b of Object.values(byCategory)) b.recallAt25 = b.recallAt25 / b.cases;
  return {
    cases: results.length,
    recallAt1: hitsWithin(1),
    recallAt5: hitsWithin(5),
    recallAt25: hitsWithin(25),
    mrr: results.reduce((s, r) => s + (r.rank ? 1 / r.rank : 0), 0) / n,
    byCategory,
  };
}

/**
 * Paired significance between two runs over the SAME cases (McNemar, exact).
 *
 * Present because the lesson that produced this file was reading 4/8 versus 3/8
 * as a result. Only discordant pairs carry information, and at small case counts
 * a lopsided-looking split is routinely chance.
 */
export function pairedPValue(before: RetrievalResult[], after: RetrievalResult[], k = 25): number {
  const rankOf = (rs: RetrievalResult[]) =>
    new Map(rs.map((r) => [r.target, r.rank !== null && r.rank <= k]));
  const b0 = rankOf(before);
  const a0 = rankOf(after);
  let b = 0;
  let c = 0;
  for (const [target, hit] of a0) {
    const prev = b0.get(target);
    if (prev === undefined) continue;
    if (hit && !prev) b++;
    else if (!hit && prev) c++;
  }
  const n = b + c;
  if (n === 0) return 1;
  const choose = (m: number, r: number): number => {
    let acc = 1;
    for (let i = 0; i < r; i++) acc = (acc * (m - i)) / (i + 1);
    return acc;
  };
  let tail = 0;
  for (let i = Math.max(b, c); i <= n; i++) tail += choose(n, i);
  return Math.min(1, (2 * tail) / 2 ** n);
}
