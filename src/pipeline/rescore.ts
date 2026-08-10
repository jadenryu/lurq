/**
 * `lurq rescore` (§4). Re-derive health scores from each package's *cached*
 * `scoreBreakdown` using the currently-loaded weight model — no re-ingestion,
 * no network. This is the payoff of storing the breakdown per package: a weight
 * edit (`edit-weights`) applies to the whole DB in one cheap pass.
 *
 * Rewrites `health_score` and re-derives the `confidence` tier, both from
 * columns already on the row. The composite (health↔quality blend) and its λ
 * are applied at read time in `recommend`, so a λ-only edit needs no rescore —
 * but running it is harmless and idempotent.
 */
import { isNotNull } from 'drizzle-orm';
import { invalidateCache } from '../core/cache';
import { logger } from '../core/logger';
import { createDb } from '../db/client';
import { getFieldEvidence } from '../db/outcomes';
import { packages } from '../db/schema';
import { computeConfidence, computeFieldScore, computeHealthScore } from '../scoring';
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
        // Everything computeConfidence needs, all already stored — so the tier
        // can be re-derived here without re-fetching anything from the network.
        confidence: packages.confidence,
        qualityScore: packages.qualityScore,
        weeklyDownloads: packages.weeklyDownloads,
        downloadGrowth90d: packages.downloadGrowth90d,
        firstPublishedAt: packages.firstPublishedAt,
        lastReleaseAt: packages.lastReleaseAt,
        advisories: packages.advisories,
        deprecated: packages.deprecated,
        archived: packages.archived,
      })
      .from(packages)
      .where(isNotNull(packages.scoreBreakdown));

    // Field evidence is refreshed here, not only at ingest. Outcomes arrive
    // continuously *after* a package is scored, so a score frozen at ingest time
    // would leave the flywheel permanently one revolution behind — the axis
    // would exist and never move. One grouped query covers the whole index.
    const evidence = await getFieldEvidence(handle.db);

    const now = new Date();
    let updated = 0;
    let fieldChanged = 0;
    let confidenceChanged = 0;
    for (const row of rows) {
      if (!row.breakdown) continue;
      const field = computeFieldScore(evidence.get(row.name) ?? null);
      const breakdown = { ...row.breakdown, field };
      const health = computeHealthScore(breakdown, weights.health);
      // `?? null` on both sides so an absent key and an explicit null compare
      // equal — otherwise every pre-field row rewrites itself on every sweep.
      const fieldMoved = (row.breakdown.field ?? null) !== field;

      // Confidence is re-derived here too, and it was not before. `rescore` is
      // the command `edit-weights` tells you to run to apply a model change to
      // the stored index, but it only ever rewrote health_score — so a change
      // to the confidence ladder reached a package only when the daily sync
      // next happened to rotate it. With the refresh cap at a few hundred a
      // day, the long tail (exactly where a mislabelled tier does damage) could
      // wait weeks. Every input is already a column on the row, so this costs
      // no network and no re-ingestion.
      const confidence = computeConfidence(
        {
          weeklyDownloads: row.weeklyDownloads,
          downloadGrowth90d: row.downloadGrowth90d,
          firstPublishedAt: row.firstPublishedAt,
          lastReleaseAt: row.lastReleaseAt,
          advisories: row.advisories ?? [],
          deprecated: row.deprecated,
          archived: row.archived,
        } as unknown as Parameters<typeof computeConfidence>[0],
        now,
        row.qualityScore,
      );
      const confidenceMoved = confidence !== row.confidence;

      if (!fieldMoved && !confidenceMoved && health === row.healthScore) continue;

      await handle.db
        .update(packages)
        .set({ healthScore: health, scoreBreakdown: breakdown, confidence, updatedAt: new Date() })
        .where(eq(packages.id, row.id));
      updated++;
      if (fieldMoved) fieldChanged++;
      if (confidenceMoved) confidenceChanged++;
    }

    logger.info(
      `Rescored ${rows.length} package(s); ${updated} changed (${fieldChanged} from field evidence, ` +
        `${confidenceChanged} confidence tier(s) re-derived, ${evidence.size} package(s) with reports).`,
    );
    if (updated > 0) await invalidateCache();
    return { seen: rows.length, updated };
  } finally {
    await handle.close();
  }
}
