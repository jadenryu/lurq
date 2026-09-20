/**
 * Public upgrade pages: what a major version removed, renamed or changed, behind
 * lurq.run/npm/<name>/<from>-to-<to>.
 *
 * THE ONE PLACE API SURFACES ARE SERVED WITHOUT A KEY, and bounded on purpose
 * (decided 2026-09-14). The pages exist so an agent that hits a breaking change
 * mid-upgrade, and searches for it, lands on lurq's evidence. That needs the
 * whole diff, not a teaser, or nothing on the page can be fixed from. What stays
 * behind a key is everything else about a surface: arbitrary version pairs,
 * `usage`, `resolve_surface`. So a pair is served only when
 *   - the package is in the public set (publicSet.ts), and
 *   - both sides are the latest stable release of their major, and the majors
 *     are consecutive among the majors that exist,
 * which is a few pages per package, not a diff API.
 *
 * A request never extracts. A pair whose surfaces are not stored yet is queued
 * and answered as pending, and the worker fills popular packages' pairs ahead of
 * anyone asking (enqueuePublicUpgrades).
 */
import { and, count, desc, gte, isNotNull, sql } from 'drizzle-orm';
import type { Express, Request, RequestHandler, Response } from 'express';
import semver from 'semver';
import { logger } from '../core/logger';
import type { Database } from '../db/client';
import { packages, surfaceQueue } from '../db/schema';
import { enqueueSurface } from '../db/surface';
import {
  PUBLIC_TOP_LIMIT,
  publicDownloadFloor,
  publicPackageRow,
  validPackageName,
} from './publicSet';
import { handleDiffSurface } from './surfaceHandlers';

export interface LatestOfMajor {
  major: number;
  version: string;
  /** A surface with symbols is stored for this version. */
  stored: boolean;
  /** An extraction has been tried (the entity exists), whether or not it stored anything. */
  attempted: boolean;
}

export interface PublicUpgradePair {
  fromMajor: number;
  toMajor: number;
  fromVersion: string;
  toVersion: string;
  /** Both sides are extracted, so the page has a diff to show. */
  ready: boolean;
}

/** Pages kept per package: the most recent major jumps are the ones people are making. */
export const PAIRS_PER_PACKAGE = 3;

/** Names per list on the wire. A jump that removes more than this is a rewrite, and says so. */
export const LIST_CAP = 500;

/**
 * Consecutive majors, oldest jump first, the newest PAIRS_PER_PACKAGE kept.
 *
 * "Consecutive among the majors that exist": a package that never shipped a 3
 * goes 2 → 4, and that is the jump its users actually make.
 */
export function majorPairs(latest: LatestOfMajor[], keep = PAIRS_PER_PACKAGE): PublicUpgradePair[] {
  const sorted = [...latest].sort((a, b) => a.major - b.major);
  const pairs: PublicUpgradePair[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const from = sorted[i - 1]!;
    const to = sorted[i]!;
    pairs.push({
      fromMajor: from.major,
      toMajor: to.major,
      fromVersion: from.version,
      toVersion: to.version,
      ready: from.stored && to.stored,
    });
  }
  return pairs.slice(-keep);
}

/**
 * The versions the worker should queue for one package's pages, newest first:
 * sides of the kept pairs that are neither stored nor already tried. A version
 * whose extraction failed stays failed until the publish feed brings a new
 * release; retrying it every hour would spend the drain on a known dead end.
 */
export function unextractedSides(latest: LatestOfMajor[], keep = PAIRS_PER_PACKAGE): string[] {
  if (latest.length < 2) return [];
  const involved = [...latest].sort((a, b) => a.major - b.major).slice(-(keep + 1));
  return involved
    .reverse()
    .filter((l) => !l.stored && !l.attempted)
    .map((l) => l.version);
}

export type UpgradeVerdict =
  | 'removes-exports'
  | 'arity-changed'
  | 'types-only'
  | 'clean'
  | 'unknown';

/**
 * The headline, worst first. Same order as the upgrade brief's (github/brief.ts),
 * plus the two cases a page must not call clean: a rename (the old name is gone
 * at runtime even though the code survives) and a type-only removal (breaks tsc,
 * not node).
 */
export function upgradeVerdict(d: {
  removed: unknown[];
  renamed: unknown[];
  arityChanged: unknown[];
  typeOnlyRemoved: unknown[];
  inconclusive?: string | null;
}): UpgradeVerdict {
  if (d.inconclusive) return 'unknown';
  if (d.removed.length > 0 || d.renamed.length > 0) return 'removes-exports';
  if (d.arityChanged.length > 0) return 'arity-changed';
  if (d.typeOnlyRemoved.length > 0) return 'types-only';
  return 'clean';
}

export interface PublicUpgrade {
  package: string;
  pair: PublicUpgradePair;
  status: 'ready' | 'pending';
  verdict: UpgradeVerdict;
  /** Gone at runtime with no replacement found. Renames are listed separately, not here. */
  removed: { path: string; kind: string }[];
  renamed: { path: string; to: string[] }[];
  arityChanged: { path: string; from: number | null; to: number | null }[];
  /** Breaks `tsc`, not `node`. */
  typeOnlyRemoved: string[];
  deprecated: string[];
  added: number;
  /** A list above was cut at LIST_CAP. */
  truncated: boolean;
  tier: string | null;
  inconclusive: string | null;
  observedAt: string | null;
}

/** The part of a `diff_surface` result a page prints. */
export interface SurfaceDiffResult {
  removed: { path: string; kind: string }[];
  renamed: { path: string; to: string[] }[];
  arityChanged: { path: string; from: number | null; to: number | null }[];
  typeOnlyRemoved: string[];
  deprecated: string[];
  added: unknown[];
  tier?: string;
  inconclusive?: string;
  observedAt: Date | string | null;
}

export function toPublicUpgrade(
  pkg: string,
  pair: PublicUpgradePair,
  diff: SurfaceDiffResult,
): PublicUpgrade {
  const renamedPaths = new Set(diff.renamed.map((r) => r.path));
  // A renamed export is also missing under its old name; listing it in both
  // would tell the reader to find a replacement that the next section names.
  const removed = diff.removed.filter((r) => !renamedPaths.has(r.path));
  const lists: unknown[][] = [
    removed,
    diff.renamed,
    diff.arityChanged,
    diff.typeOnlyRemoved,
    diff.deprecated,
  ];
  const cap = <T>(xs: T[]): T[] => xs.slice(0, LIST_CAP);
  return {
    package: pkg,
    pair,
    status: 'ready',
    verdict: upgradeVerdict({ ...diff, removed }),
    removed: cap(removed.map((r) => ({ path: r.path, kind: r.kind }))),
    renamed: cap(diff.renamed),
    arityChanged: cap(diff.arityChanged),
    typeOnlyRemoved: cap(diff.typeOnlyRemoved),
    deprecated: cap(diff.deprecated),
    added: diff.added.length,
    truncated: lists.some((l) => l.length > LIST_CAP),
    tier: diff.tier ?? null,
    inconclusive: diff.inconclusive ?? null,
    observedAt: diff.observedAt ? new Date(diff.observedAt).toISOString() : null,
  };
}

export function pendingUpgrade(pkg: string, pair: PublicUpgradePair): PublicUpgrade {
  return {
    package: pkg,
    pair,
    status: 'pending',
    verdict: 'unknown',
    removed: [],
    renamed: [],
    arityChanged: [],
    typeOnlyRemoved: [],
    deprecated: [],
    added: 0,
    truncated: false,
    tier: null,
    inconclusive: 'Both versions are queued for extraction. NOT evidence that nothing changed.',
    observedAt: null,
  };
}

function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? result) as T[];
}

/**
 * The latest stable release of every major, per package, with whether each is
 * extracted. One query for any number of names.
 */
export async function latestOfMajors(
  db: Database,
  names: string[],
): Promise<Map<string, LatestOfMajor[]>> {
  const out = new Map<string, LatestOfMajor[]>();
  if (names.length === 0) return out;
  const result = await db.execute(sql`
    with stable as (
      select package_name, version, (regexp_match(version, '^([0-9]+)\\.'))[1]::int as major
      from package_versions
      where package_name in (${sql.join(
        names.map((n) => sql`${n}`),
        sql`, `,
      )})
        -- Stable releases only: an upgrade does not land on a prerelease.
        and version ~ '^[0-9]+\\.[0-9]+\\.[0-9]+$'
    ),
    latest as (
      select distinct on (package_name, major) package_name, major, version
      from stable
      -- Numeric, not lexical (16.10.0 is newer than 16.9.0), and numeric rather
      -- than int so a date-stamped version cannot overflow the cast.
      order by package_name, major, string_to_array(version, '.')::numeric[] desc
    )
    select
      l.package_name,
      l.major,
      l.version,
      exists (
        select 1 from entities e
        join symbols s on s.entity_id = e.id and s.tier = 'shipped_js_ast'
        where e.canonical_key = 'package_surface:npm:' || l.package_name || ':' || l.version
          and e.tenant_id = 0
      ) as stored,
      exists (
        select 1 from entities e
        where e.canonical_key = 'package_surface:npm:' || l.package_name || ':' || l.version
          and e.tenant_id = 0
      ) as attempted
    from latest l
  `);
  for (const r of rowsOf<{
    package_name: string;
    major: number | string;
    version: string;
    stored: boolean;
    attempted: boolean;
  }>(result)) {
    const list = out.get(r.package_name) ?? [];
    list.push({
      major: Number(r.major),
      version: r.version,
      stored: Boolean(r.stored),
      attempted: Boolean(r.attempted),
    });
    out.set(r.package_name, list);
  }
  return out;
}

export async function upgradePairsFor(db: Database, name: string): Promise<PublicUpgradePair[]> {
  return majorPairs((await latestOfMajors(db, [name])).get(name) ?? []);
}

/**
 * The public page for a diff's major jump, when that page has a diff to show.
 *
 * Attached to `diff_surface` results, so an agent explaining a break can hand
 * the user the complete list for that jump. Only a ready page: a link to a
 * pending one would be a link to "come back later". The page compares the
 * latest release of each major, so it names its own versions; a diff between
 * other patch releases of the same majors is usually, not always, the same.
 *
 * ponytail: two small indexed reads on every diff_surface call, uncached; cache
 * per package if that tool's latency ever shows it.
 */
export async function upgradeGuideFor(
  db: Database,
  pkg: string,
  fromVersion: string,
  toVersion: string,
  webUrl: string,
): Promise<{ url: string; fromVersion: string; toVersion: string } | null> {
  const from = semver.coerce(fromVersion)?.major;
  const to = semver.coerce(toVersion)?.major;
  if (from === undefined || to === undefined || to <= from) return null;
  if (!(await publicPackageRow(db, pkg))) return null;
  const pair = (await upgradePairsFor(db, pkg)).find(
    (p) => p.fromMajor === from && p.toMajor === to && p.ready,
  );
  if (!pair) return null;
  const path = `/npm/${pkg.split('/').map(encodeURIComponent).join('/')}/${from}-to-${to}`;
  return {
    url: `${webUrl.replace(/\/$/, '')}${path}`,
    fromVersion: pair.fromVersion,
    toVersion: pair.toVersion,
  };
}

/** The public set, most downloaded first. */
async function publicNames(db: Database, limit = PUBLIC_TOP_LIMIT): Promise<string[]> {
  const min = await publicDownloadFloor(db);
  const rows = await db
    .select({ name: packages.name })
    .from(packages)
    .where(and(isNotNull(packages.healthScore), gte(packages.weeklyDownloads, min)))
    .orderBy(desc(packages.weeklyDownloads))
    .limit(limit);
  return rows.map((r) => r.name);
}

/** Specs past which the worker stops adding page work, so demand-driven misses never wait behind it. */
export const QUEUE_HEADROOM = 20;

/**
 * Queue unextracted sides of popular packages' upgrade pages, only while the
 * surface queue has headroom. The drain takes the oldest spec first, so a queue
 * this pass had filled would make every agent's real miss wait behind pages
 * nobody has asked for yet. Returns how many specs were queued.
 */
export async function enqueuePublicUpgrades(
  db: Database,
  opts: { packages?: number } = {},
): Promise<number> {
  const [{ pending } = { pending: 0 }] = await db.select({ pending: count() }).from(surfaceQueue);
  let budget = QUEUE_HEADROOM - Number(pending);
  if (budget <= 0) return 0;

  const names = await publicNames(db, opts.packages ?? 1_000);
  let queued = 0;
  for (let i = 0; i < names.length && budget > 0; i += 250) {
    const chunk = names.slice(i, i + 250);
    const latest = await latestOfMajors(db, chunk);
    for (const name of chunk) {
      for (const version of unextractedSides(latest.get(name) ?? [])) {
        if (budget <= 0) break;
        await enqueueSurface(db, name, version);
        queued++;
        budget--;
      }
      if (budget <= 0) break;
    }
  }
  return queued;
}

export function registerPublicUpgradeRoutes(
  app: Express,
  db: Database,
  limiter: RequestHandler,
): void {
  const cacheable = (res: Response) =>
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');

  app.get('/public/upgrade', limiter, async (req: Request, res: Response) => {
    const name = typeof req.query.name === 'string' ? req.query.name.trim() : '';
    const from = Number(req.query.from);
    const to = Number(req.query.to);
    if (
      !validPackageName(name) ||
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from < 0 ||
      to <= from
    ) {
      res.status(400).json({ error: 'Give an npm package name and two majors, from < to.' });
      return;
    }
    try {
      if (!(await publicPackageRow(db, name))) {
        res.status(404).json({ error: 'No public upgrade pages for that package.' });
        return;
      }
      const pairs = await upgradePairsFor(db, name);
      const pair = pairs.find((p) => p.fromMajor === from && p.toMajor === to);
      if (!pair) {
        // The jumps that do have pages, so a caller that guessed wrong can follow one.
        res.status(404).json({ error: 'No upgrade page for that version jump.', pairs });
        return;
      }
      if (!pair.ready) {
        await Promise.all([
          enqueueSurface(db, name, pair.fromVersion),
          enqueueSurface(db, name, pair.toVersion),
        ]).catch(() => {});
        res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=900');
        res.json(pendingUpgrade(name, pair));
        return;
      }
      const diff = (await handleDiffSurface(db, {
        package: name,
        fromVersion: pair.fromVersion,
        toVersion: pair.toVersion,
      })) as SurfaceDiffResult;
      const body = toPublicUpgrade(name, pair, diff);
      // A diff that came back unknown may be a fill in progress; do not let a CDN hold it for a day.
      if (body.verdict === 'unknown')
        res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=900');
      else cacheable(res);
      res.json(body);
    } catch (err) {
      logger.error('public upgrade read failed:', err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: 'Could not read that upgrade.' });
    }
  });

  /**
   * Every ready page, for the sitemap. The one expensive read here (latest of
   * every major for the whole public set), so it is cached for an hour.
   *
   * ponytail: per-process cache, recomputed on expiry by whichever request
   * lands first; move it to the worker if that request ever gets slow.
   */
  let index: { at: number; value: { package: string; pairs: PublicUpgradePair[] }[] } | null = null;
  app.get('/public/upgrades', limiter, async (_req: Request, res: Response) => {
    try {
      if (!index || Date.now() - index.at > 3_600_000) {
        const names = await publicNames(db);
        const value: { package: string; pairs: PublicUpgradePair[] }[] = [];
        for (let i = 0; i < names.length; i += 500) {
          const chunk = names.slice(i, i + 500);
          const latest = await latestOfMajors(db, chunk);
          for (const name of chunk) {
            const ready = majorPairs(latest.get(name) ?? []).filter((p) => p.ready);
            if (ready.length) value.push({ package: name, pairs: ready });
          }
        }
        index = { at: Date.now(), value };
      }
      cacheable(res);
      res.json({ upgrades: index.value });
    } catch (err) {
      logger.error(
        'public upgrade index failed:',
        err instanceof Error ? err.message : String(err),
      );
      res.status(500).json({ error: 'Could not list upgrade pages.' });
    }
  });
}
