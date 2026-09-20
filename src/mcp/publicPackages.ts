/**
 * Public package summaries: the data behind lurq.run/npm/<name>.
 *
 * These pages exist to be found. An agent or a person searching "is <package>
 * still maintained" or "<package> alternatives" should land on an answer backed
 * by lurq's evidence, and see that their agent can ask the same question live.
 *
 * DELIBERATELY A SUMMARY. The index is the asset, so the public shape carries
 * the headline (score, confidence, verdict, flags, alternatives) and never the
 * score breakdown, usage guide or compatibility edges. Those stay behind a key.
 * API surfaces too, with one bounded exception: the major-version upgrade pages
 * in publicUpgrades.ts, listed here as `upgrades`. Only packages in the public
 * set (publicSet.ts) are served at all.
 */
import { and, desc, eq, gte, isNotNull, ne } from 'drizzle-orm';
import type { Express, Request, RequestHandler, Response } from 'express';
import { logger } from '../core/logger';
import type { Database } from '../db/client';
import type { getPackageByName } from '../db/packages';
import { packages } from '../db/schema';
import { assessVerdict } from '../security/verdict';
import {
  PUBLIC_TOP_LIMIT,
  publicDownloadFloor,
  publicPackageRow,
  validPackageName,
} from './publicSet';
import { upgradePairsFor, type PublicUpgradePair } from './publicUpgrades';

export { PUBLIC_TOP_LIMIT };

type PackageRow = NonNullable<Awaited<ReturnType<typeof getPackageByName>>>;

export interface PublicAlternative {
  name: string;
  healthScore: number | null;
  confidence: string | null;
}

export interface PublicPackageSummary {
  name: string;
  description: string | null;
  latestVersion: string | null;
  license: string | null;
  category: string | null;
  repoUrl: string | null;
  homepage: string | null;
  healthScore: number | null;
  confidence: string | null;
  weeklyDownloads: number | null;
  stars: number | null;
  lastReleaseAt: string | null;
  deprecated: boolean;
  archived: boolean;
  /** null = advisories not yet checked, which is not the same as none. */
  advisories: { total: number; severe: number } | null;
  verdict: { level: string; reasons: string[] };
  alternatives: PublicAlternative[];
  /** Major-version jumps that have an upgrade page; `ready` ones have a diff to show. */
  upgrades: PublicUpgradePair[];
  dataAsOf: string | null;
}

export function toPublicSummary(
  row: PackageRow,
  alternatives: PublicAlternative[],
  upgrades: PublicUpgradePair[] = [],
): PublicPackageSummary {
  const advisories = row.advisories ?? null;
  const verdict = assessVerdict({
    exists: true,
    advisories,
    deprecated: row.deprecated,
    archived: row.archived,
    lowTrust: (row.weeklyDownloads ?? 0) < 1_000,
  });
  return {
    name: row.name,
    description: row.summary ?? row.description ?? null,
    latestVersion: row.latestVersion ?? null,
    license: row.license ?? null,
    category: row.category ?? null,
    repoUrl: row.repoUrl ?? null,
    homepage: row.homepage ?? null,
    healthScore: row.healthScore ?? null,
    confidence: row.confidence ?? null,
    weeklyDownloads: row.weeklyDownloads ?? null,
    stars: row.stars ?? null,
    lastReleaseAt: row.lastReleaseAt?.toISOString() ?? null,
    deprecated: row.deprecated,
    archived: row.archived,
    advisories:
      advisories === null
        ? null
        : {
            total: advisories.length,
            severe: advisories.filter((a) => a.severity === 'critical' || a.severity === 'high')
              .length,
          },
    verdict: { level: verdict.level, reasons: verdict.reasons.slice(0, 3) },
    alternatives,
    upgrades,
    dataAsOf: row.dataAsOf?.toISOString() ?? null,
  };
}

/** Best-scored packages in the same category, for the page's internal links. */
async function alternativesFor(db: Database, row: PackageRow): Promise<PublicAlternative[]> {
  if (!row.category) return [];
  return db
    .select({
      name: packages.name,
      healthScore: packages.healthScore,
      confidence: packages.confidence,
    })
    .from(packages)
    .where(
      and(
        eq(packages.category, row.category),
        eq(packages.ecosystem, row.ecosystem),
        ne(packages.name, row.name),
        isNotNull(packages.healthScore),
        isNotNull(packages.weeklyDownloads),
      ),
    )
    .orderBy(desc(packages.healthScore), desc(packages.weeklyDownloads))
    .limit(5);
}

export function registerPublicPackageRoutes(
  app: Express,
  db: Database,
  limiter: RequestHandler,
): void {
  const cacheable = (res: Response) =>
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');

  app.get('/public/package', limiter, async (req: Request, res: Response) => {
    const name = typeof req.query.name === 'string' ? req.query.name.trim() : '';
    if (!validPackageName(name)) {
      res.status(400).json({ error: 'Give an npm package name.' });
      return;
    }
    try {
      const row = await publicPackageRow(db, name);
      if (!row) {
        res.status(404).json({ error: 'No public summary for that package.' });
        return;
      }
      const [alternatives, upgrades] = await Promise.all([
        alternativesFor(db, row),
        // The upgrade links are an extra, never a reason the summary fails.
        upgradePairsFor(db, row.name).catch(() => []),
      ]);
      cacheable(res);
      res.json(toPublicSummary(row, alternatives, upgrades));
    } catch (err) {
      logger.error('public package read failed:', err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: 'Could not read that package.' });
    }
  });

  app.get('/public/packages', limiter, async (_req: Request, res: Response) => {
    try {
      const min = await publicDownloadFloor(db);
      const rows = await db
        .select({ name: packages.name, dataAsOf: packages.dataAsOf })
        .from(packages)
        .where(and(isNotNull(packages.healthScore), gte(packages.weeklyDownloads, min)))
        .orderBy(desc(packages.weeklyDownloads))
        .limit(PUBLIC_TOP_LIMIT);
      cacheable(res);
      res.json({
        packages: rows.map((r) => ({ name: r.name, dataAsOf: r.dataAsOf?.toISOString() ?? null })),
      });
    } catch (err) {
      logger.error('public package list failed:', err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: 'Could not list packages.' });
    }
  });
}
