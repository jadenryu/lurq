/**
 * `lurq rescore` (§4). Re-derive health scores from each package's *cached*
 * `scoreBreakdown` using the currently-loaded weight model — no re-ingestion,
 * no network. This is the payoff of storing the breakdown per package: a weight
 * edit (`edit-weights`) applies to the whole DB in one cheap pass.
 *
 * Only health weights change a stored value (`health_score`). The composite
 * (health↔quality blend) and its λ are applied at read time in `recommend`, so
 * a λ-only edit needs no rescore — but running it is harmless and idempotent.
 */
import { isNotNull } from 'drizzle-orm';
import { logger } from '../core/logger';
import { createDb } from '../db/client';
import { packages } from '../db/schema';
import { computeHealthScore } from '../scoring';
import { loadWeights } from '../scoring/weights';
import { eq } from 'drizzle-orm';

export interface RescoreSummary {
  seen: number;
  updated: number;
}

export async function runRescore(): Promise<RescoreSummary> {
  const weights = loadWeights();
  const handle = createDb({ max: 4 });
  try {
    const rows = await handle.db
      .select({ id: packages.id, breakdown: packages.scoreBreakdown, healthScore: packages.healthScore })
      .from(packages)
      .where(isNotNull(packages.scoreBreakdown));

    let updated = 0;
    for (const row of rows) {
      if (!row.breakdown) continue;
      const health = computeHealthScore(row.breakdown, weights.health);
      if (health !== row.healthScore) {
        await handle.db
          .update(packages)
          .set({ healthScore: health, updatedAt: new Date() })
          .where(eq(packages.id, row.id));
        updated++;
      }
    }

    logger.info(`Rescored ${rows.length} package(s); ${updated} health score(s) changed.`);
    return { seen: rows.length, updated };
  } finally {
    await handle.close();
  }
}
