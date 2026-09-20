/**
 * Saved builder reports for the dashboard (issuer secret).
 *
 * The web app is the only writer: it saves the profile the backend's own
 * `/scan/profile` computed, after a signed-in scan. The body is still
 * shape-checked, because a malformed row would break the report every time the
 * account reopened it, not just once.
 *
 * Both routes a signed-in report goes through (reopen, save) answer with the
 * builder's standing, so percentiles cost the web app no extra round trip.
 */
import type { Express, Request, RequestHandler, Response } from 'express';
import { formatError } from '../core/errors';
import { logger } from '../core/logger';
import {
  builderPopulation,
  getBuilderScan,
  listBuilderScans,
  saveBuilderScan,
  type PopulationRow,
} from '../db/builderScans';
import type { Database } from '../db/client';
import type { BuilderProfile } from '../github/builderProfile';
import {
  builderMetrics,
  standing,
  type BuilderMetrics,
  type BuilderStanding,
} from '../github/builderStanding';
import { parseTarget } from '../github/publicScan';

export interface BuilderScanRouteDeps {
  db: Database;
  requireIssuerSecret: RequestHandler;
  ownerFrom: (req: Request) => string;
}

/** Six stack scans with their dependency rows come to tens of KB; this is headroom, not a target. */
export const MAX_PROFILE_BYTES = 512_000;

/**
 * ponytail: the whole population in memory, reloaded every five minutes per
 * process. Seven integers a builder, so fine into the tens of thousands; past
 * that, rank in SQL (a count per metric column) instead of shipping every row.
 */
const POPULATION_TTL_MS = 5 * 60_000;

const ARCHETYPES = new Set(['shipper', 'architect', 'explorer', 'steward']);

/**
 * One key per thing scanned: `login` or `login/repo`, lowercased, because GitHub
 * names are case-insensitive and a pasted URL means the same profile as a name.
 */
export function scanKey(raw: string): string | null {
  const t = parseTarget(raw);
  if (!t) return null;
  return (t.kind === 'repo' ? `${t.owner}/${t.name}` : t.login).toLowerCase();
}

function asProfile(value: unknown): BuilderProfile | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  const ok =
    typeof p.login === 'string' &&
    typeof p.url === 'string' &&
    typeof p.avatarUrl === 'string' &&
    typeof p.archetype === 'string' &&
    ARCHETYPES.has(p.archetype) &&
    Array.isArray(p.traits) &&
    Array.isArray(p.repos) &&
    !!p.stats &&
    typeof p.stats === 'object';
  return ok ? (value as BuilderProfile) : null;
}

export function registerBuilderScanRoutes(app: Express, deps: BuilderScanRouteDeps): void {
  const { db, requireIssuerSecret, ownerFrom } = deps;

  let population: { at: number; rows: Promise<PopulationRow[]> } | null = null;
  const loadPopulation = (): Promise<PopulationRow[]> => {
    if (!population || Date.now() - population.at > POPULATION_TTL_MS) {
      const rows = builderPopulation(db);
      population = { at: Date.now(), rows };
      // A failed load must not be served for five minutes.
      rows.catch(() => {
        if (population?.rows === rows) population = null;
      });
    }
    return population.rows;
  };

  /** Never fails the route: a report without percentiles is still the report. */
  const standingFor = async (
    login: string,
    metrics: BuilderMetrics,
  ): Promise<BuilderStanding | null> => {
    try {
      const self = login.toLowerCase();
      const others = (await loadPopulation()).filter((r) => r.login !== self);
      return standing(metrics, others);
    } catch (err) {
      logger.error('builder standing failed:', formatError(err));
      return null;
    }
  };

  app.get('/builder-scans', requireIssuerSecret, async (req: Request, res: Response) => {
    const ownerId = ownerFrom(req);
    if (!ownerId) {
      res.status(400).json({ error: 'ownerId is required.' });
      return;
    }
    try {
      res.json({ scans: await listBuilderScans(db, ownerId) });
    } catch (err) {
      logger.error('builder scan list failed:', formatError(err));
      res.status(500).json({ error: 'Could not read saved scans.' });
    }
  });

  app.get('/builder-scans/one', requireIssuerSecret, async (req: Request, res: Response) => {
    const ownerId = ownerFrom(req);
    const target = scanKey(typeof req.query.target === 'string' ? req.query.target : '');
    if (!ownerId || !target) {
      res.status(400).json({ error: 'ownerId and a valid target are required.' });
      return;
    }
    try {
      const scan = await getBuilderScan(db, ownerId, target);
      if (!scan) {
        res.status(404).json({ error: 'No saved scan for that target.' });
        return;
      }
      const { profile, scannedAt, metrics } = scan;
      res.json({
        scan: { target, profile, scannedAt, standing: await standingFor(profile.login, metrics) },
      });
    } catch (err) {
      logger.error('builder scan read failed:', formatError(err));
      res.status(500).json({ error: 'Could not read that saved scan.' });
    }
  });

  app.put('/builder-scans', requireIssuerSecret, async (req: Request, res: Response) => {
    const ownerId = ownerFrom(req);
    const body = (req.body ?? {}) as { target?: unknown; profile?: unknown };
    const target = scanKey(typeof body.target === 'string' ? body.target : '');
    const profile = asProfile(body.profile);
    if (!ownerId || !target || !profile) {
      res
        .status(400)
        .json({ error: 'ownerId, a valid target and a builder profile are required.' });
      return;
    }
    if (JSON.stringify(profile).length > MAX_PROFILE_BYTES) {
      res.status(413).json({ error: 'That profile is too large to save.' });
      return;
    }
    try {
      const scannedAt = await saveBuilderScan(db, ownerId, target, profile);
      res.json({
        target,
        scannedAt,
        standing: await standingFor(profile.login, builderMetrics(profile)),
      });
    } catch (err) {
      logger.error('builder scan save failed:', formatError(err));
      res.status(500).json({ error: 'Could not save that scan.' });
    }
  });
}
