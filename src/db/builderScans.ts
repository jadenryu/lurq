/**
 * Saved builder reports: the last scan of each target, per account.
 *
 * Written by the web app after a signed-in scan and read back when the report
 * is reopened, so coming back to a report costs no GitHub calls and shows the
 * numbers the account actually saw. See `builderScans` in schema.ts for why a
 * rescan overwrites rather than appends.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import type { BuilderProfile, Trait } from '../github/builderProfile';
import { builderMetrics, type BuilderMetrics } from '../github/builderStanding';
import type { Database } from './client';
import { builderScans } from './schema';

/** What the saved list shows: enough for a card, never the dependency rows. */
export interface BuilderScanSummary {
  target: string;
  login: string;
  archetype: BuilderProfile['archetype'];
  avatarUrl: string;
  traits: Trait[];
  stats: BuilderProfile['stats'];
  scannedAt: Date;
}

export async function saveBuilderScan(
  db: Database,
  ownerId: string,
  target: string,
  profile: BuilderProfile,
): Promise<Date> {
  const scannedAt = new Date();
  const listing = {
    login: profile.login,
    archetype: profile.archetype,
    avatarUrl: profile.avatarUrl,
    ...builderMetrics(profile),
  };
  await db
    .insert(builderScans)
    .values({ ownerId, target, ...listing, profile, scannedAt })
    .onConflictDoUpdate({
      target: [builderScans.ownerId, builderScans.target],
      set: { ...listing, profile, scannedAt },
    });
  return scannedAt;
}

/**
 * Most recent first.
 *
 * ponytail: a fixed cap, no paging. One row per distinct target, so an account
 * past it has scanned more than two dozen different people; page when the list
 * ever shows that.
 */
export async function listBuilderScans(
  db: Database,
  ownerId: string,
  limit = 24,
): Promise<BuilderScanSummary[]> {
  return db
    .select({
      target: builderScans.target,
      login: builderScans.login,
      archetype: builderScans.archetype,
      avatarUrl: builderScans.avatarUrl,
      traits: sql<Trait[]>`${builderScans.profile}->'traits'`,
      stats: sql<BuilderProfile['stats']>`${builderScans.profile}->'stats'`,
      scannedAt: builderScans.scannedAt,
    })
    .from(builderScans)
    .where(eq(builderScans.ownerId, ownerId))
    .orderBy(desc(builderScans.scannedAt))
    .limit(limit);
}

const METRIC_COLUMNS = {
  repos: builderScans.repos,
  active90: builderScans.active90,
  stars: builderScans.stars,
  depsTracked: builderScans.depsTracked,
  depsBehind: builderScans.depsBehind,
  depsMajor: builderScans.depsMajor,
  advisories: builderScans.advisories,
};

export async function getBuilderScan(
  db: Database,
  ownerId: string,
  target: string,
): Promise<{ profile: BuilderProfile; scannedAt: Date; metrics: BuilderMetrics } | null> {
  const rows = await db
    .select({ profile: builderScans.profile, scannedAt: builderScans.scannedAt, ...METRIC_COLUMNS })
    .from(builderScans)
    .where(and(eq(builderScans.ownerId, ownerId), eq(builderScans.target, target)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const { profile, scannedAt, ...metrics } = row;
  return { profile, scannedAt, metrics };
}

export interface PopulationRow extends BuilderMetrics {
  /** Lowercased, so the caller can leave the subject out. */
  login: string;
}

/**
 * Everyone to rank against: one row per GitHub login, its most recent save by
 * any account. Without the dedupe, a builder three accounts looked at would
 * count three times, and a popular profile would drag every percentile toward
 * itself.
 */
export async function builderPopulation(db: Database): Promise<PopulationRow[]> {
  const login = sql<string>`lower(${builderScans.login})`;
  return db
    .selectDistinctOn([login], { login, ...METRIC_COLUMNS })
    .from(builderScans)
    .orderBy(login, desc(builderScans.scannedAt));
}
