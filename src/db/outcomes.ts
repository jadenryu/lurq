/** Read/write helpers for recommendation→outcome capture (`recommendation_outcomes`, §3.1). */
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { DEFAULT_ECOSYSTEM } from '../core/types';
import { alias } from 'drizzle-orm/pg-core';
import { buildLearnedSuccessors, type LearnedSuccessors } from '../core/successors';
import type { FieldEvidence } from '../scoring/score';
import type { Database } from './client';
import {
  packages,
  recommendationOutcomes,
  type NewRecommendationOutcomeRow,
  type RecommendationOutcomeRow,
} from './schema';

/** Record one opt-in outcome. Insert-only — the dataset is append-only by design. */
export async function recordOutcome(
  db: Database,
  outcome: NewRecommendationOutcomeRow,
): Promise<void> {
  await db.insert(recommendationOutcomes).values(outcome);
}

/**
 * A report counts as a success when the agent kept the package AND it did not
 * fail to build. `build_signal IS NULL` is a report with no build stage attached
 * — an acceptance on its own — and counts, because the alternative is treating
 * "didn't say" as "broke".
 */
const SUCCESS_PREDICATE = sql`${recommendationOutcomes.accepted} AND (${recommendationOutcomes.buildSignal} IS NULL OR ${recommendationOutcomes.buildSignal} <> 'failed')`;

/**
 * Aggregate field evidence per package (§3.1) — the read side of the flywheel.
 *
 * One grouped scan, never one query per package: this runs inside ingest and
 * inside the rescore sweep, and a per-package round trip would make the sweep
 * O(index size) in network calls. `recommendation_outcomes_pkg_idx` covers the
 * grouping.
 *
 * Omit `names` to aggregate every package that has any report at all. That set
 * is small — outcomes are opt-in and sparse relative to the index — which is
 * exactly why the rescore sweep can afford to refresh all of them.
 */
export async function getFieldEvidence(
  db: Database,
  names?: string[],
): Promise<Map<string, FieldEvidence>> {
  if (names && names.length === 0) return new Map();

  const rows = await db
    .select({
      packageName: recommendationOutcomes.packageName,
      reports: count(),
      successes: sql<number>`count(*) FILTER (WHERE ${SUCCESS_PREDICATE})`.mapWith(Number),
    })
    .from(recommendationOutcomes)
    .where(names ? inArray(recommendationOutcomes.packageName, names) : undefined)
    .groupBy(recommendationOutcomes.packageName);

  return new Map(
    rows.map((r) => [r.packageName, { reports: Number(r.reports), successes: r.successes }]),
  );
}

/**
 * Minimum distinct owners before a learned succession is believed.
 *
 * One person reporting "X failed, then Y worked" is an anecdote, and publishing
 * it as an index-wide claim would let any single key steer what every agent
 * recommends. Three unrelated accounts converging on the same substitution is a
 * pattern. Same discipline as the shrinkage prior in scoring: the signal has to
 * survive the cheapest way to fake it.
 */
export const MIN_SUCCESSION_OWNERS = 3;

/** A substitution observed in the field, with the evidence behind it. */
export interface LearnedSuccession {
  from: string;
  to: string;
  owners: number;
  observations: number;
}

/**
 * Derive successor candidates from outcome history (§3.1).
 *
 * The observation: within one owner's work on one stated need, a package that
 * FAILED followed by a different package that SUCCEEDED is a substitution. It is
 * the only place lurq sees a replacement actually chosen under real constraints
 * rather than asserted in a changelog — and it needs no new data collection,
 * because `need` and `build_signal` have been captured since report_outcome
 * shipped.
 *
 * Ordered by `created_at`, so the direction is earned rather than assumed: Y
 * replaced X only if Y came after X failed. Without that clause the join would
 * happily report X replacing Y as well.
 */
export async function learnSuccessions(db: Database): Promise<LearnedSuccession[]> {
  const failed = alias(recommendationOutcomes, 'failed');
  const worked = alias(recommendationOutcomes, 'worked');

  const rows = await db
    .select({
      from: failed.packageName,
      to: worked.packageName,
      owners: sql<number>`count(DISTINCT ${failed.ownerId})`.mapWith(Number),
      observations: sql<number>`count(*)`.mapWith(Number),
    })
    .from(failed)
    .innerJoin(
      worked,
      sql`${worked.ownerId} = ${failed.ownerId}
        AND ${worked.need} = ${failed.need}
        AND ${worked.packageName} <> ${failed.packageName}
        AND ${worked.createdAt} > ${failed.createdAt}`,
    )
    .where(
      sql`${failed.need} IS NOT NULL
        AND ${failed.ownerId} IS NOT NULL
        AND NOT (${failed.accepted} AND (${failed.buildSignal} IS NULL OR ${failed.buildSignal} <> 'failed'))
        AND (${worked.accepted} AND (${worked.buildSignal} IS NULL OR ${worked.buildSignal} <> 'failed'))`,
    )
    .groupBy(failed.packageName, worked.packageName)
    .having(sql`count(DISTINCT ${failed.ownerId}) >= ${MIN_SUCCESSION_OWNERS}`);

  return rows.map((r) => ({
    from: r.from,
    to: r.to,
    owners: Number(r.owners),
    observations: Number(r.observations),
  }));
}

/**
 * The learned successor map, memoised in-process.
 *
 * The underlying self-join is not cheap and the answer moves on the order of
 * hours, so recomputing it per `evaluate` would be pure waste. A per-instance
 * memo is enough: instances disagreeing for a few minutes about a successor
 * hint is invisible, and the alternative is coordinating an invalidation across
 * the fleet for a field that is advisory by nature.
 *
 * ponytail: in-process TTL, no cross-instance coherence. Move to the Redis
 * cache if the recompute cost ever shows up in latency.
 */
const LEARNED_TTL_MS = 10 * 60 * 1000;
let learnedCache: { at: number; value: LearnedSuccessors } | null = null;

export async function loadLearnedSuccessors(
  db: Database,
  now: number = Date.now(),
): Promise<LearnedSuccessors> {
  if (learnedCache && now - learnedCache.at < LEARNED_TTL_MS) return learnedCache.value;

  const observed = await learnSuccessions(db);
  if (observed.length === 0) {
    learnedCache = { at: now, value: new Map() };
    return learnedCache.value;
  }

  // Only packages the index already knows are dead may acquire a successor —
  // see buildLearnedSuccessors. One lookup for every candidate, not one each.
  const names = [...new Set(observed.map((o) => o.from))];
  const rows = await db
    .select({ name: packages.name, deprecated: packages.deprecated, archived: packages.archived })
    .from(packages)
    .where(and(inArray(packages.name, names), eq(packages.ecosystem, DEFAULT_ECOSYSTEM)));
  const dead = new Set(rows.filter((r) => r.deprecated || r.archived).map((r) => r.name));

  const value = buildLearnedSuccessors(observed, (name) => dead.has(name));
  learnedCache = { at: now, value };
  return value;
}

/** Drop the memo — for tests and for the worker after an ingest sweep. */
export function resetLearnedSuccessors(): void {
  learnedCache = null;
}

/** One owner's outcome history, newest first — powers the dashboard activity feed. */
export async function getOutcomesByOwner(
  db: Database,
  ownerId: string,
  opts: { limit?: number } = {},
): Promise<RecommendationOutcomeRow[]> {
  return db
    .select()
    .from(recommendationOutcomes)
    .where(eq(recommendationOutcomes.ownerId, ownerId))
    .orderBy(desc(recommendationOutcomes.createdAt))
    .limit(opts.limit ?? 50);
}
