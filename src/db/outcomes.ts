/** Read/write helpers for recommendation→outcome capture (`recommendation_outcomes`, §3.1). */
import { count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FieldEvidence } from '../scoring/score';
import type { Database } from './client';
import {
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
