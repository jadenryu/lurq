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
import { invalidateCache } from '../core/cache';
import { logger } from '../core/logger';
import { createDb } from '../db/client';
import { getFieldEvidence } from '../db/outcomes';
import { packages } from '../db/schema';
import { computeFieldScore, computeHealthScore } from '../scoring';
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
      .select({
        id: packages.id,
        name: packages.name,
        breakdown: packages.scoreBreakdown,
        healthScore: packages.healthScore,
      })
      .from(packages)
      .where(isNotNull(packages.scoreBreakdown));

    // Field evidence is refreshed here, not only at ingest. Outcomes arrive
    // continuously *after* a package is scored, so a score frozen at ingest time
    // would leave the flywheel permanently one revolution behind — the axis
    // would exist and never move. One grouped query covers the whole index.
    const evidence = await getFieldEvidence(handle.db);

    let updated = 0;
    let fieldChanged = 0;
    for (const row of rows) {
      if (!row.breakdown) continue;
      const field = computeFieldScore(evidence.get(row.name) ?? null);
      const breakdown = { ...row.breakdown, field };
      const health = computeHealthScore(breakdown, weights.health);
      // `?? null` on both sides so an absent key and an explicit null compare
      // equal — otherwise every pre-field row rewrites itself on every sweep.
      const fieldMoved = (row.breakdown.field ?? null) !== field;
      if (!fieldMoved && health === row.healthScore) continue;

      await handle.db
        .update(packages)
        .set({ healthScore: health, scoreBreakdown: breakdown, updatedAt: new Date() })
        .where(eq(packages.id, row.id));
      updated++;
      if (fieldMoved) fieldChanged++;
    }

    logger.info(
      `Rescored ${rows.length} package(s); ${updated} changed (${fieldChanged} from field evidence, ${evidence.size} package(s) with reports).`,
    );
    if (updated > 0) await invalidateCache();
    return { seen: rows.length, updated };
  } finally {
    await handle.close();
  }
}
