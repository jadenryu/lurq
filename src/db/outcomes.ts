/** Read/write helpers for recommendation→outcome capture (`recommendation_outcomes`, §3.1). */
import { desc, eq } from 'drizzle-orm';
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
