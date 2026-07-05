/** Write helper for recommendation→outcome capture (`recommendation_outcomes`, §3.1). */
import type { Database } from './client';
import { recommendationOutcomes, type NewRecommendationOutcomeRow } from './schema';

/** Record one opt-in outcome. Insert-only — the dataset is append-only by design. */
export async function recordOutcome(
  db: Database,
  outcome: NewRecommendationOutcomeRow,
): Promise<void> {
  await db.insert(recommendationOutcomes).values(outcome);
}
