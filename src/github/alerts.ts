/**
 * Publish alerts: a breaking release lands, and the repos that depend on it hear
 * about it now rather than at the next nightly scan.
 *
 * lurq already learns of a publish within seconds — the `_changes` follower
 * re-syncs any tracked package the registry touches (src/pipeline/watch.ts) — and
 * it already knows which connected repos declare that package, because the last
 * scan stored their manifests. Those two facts never met: drift was recomputed on
 * a 24h cron and acted on by a weekly CI job, so a major that shipped on Tuesday
 * reached the repo up to a week later. This module is the join.
 *
 * Scope discipline, same as everywhere else in the repo autopilot: an alert is
 * computed from `repos.manifests` and the package row. No GitHub call, no source
 * read, no clone. That is not only a privacy property — it is what makes the
 * fan-out safe, because a package with a thousand dependents publishing is one
 * indexed query and one bulk insert, not a thousand API requests.
 *
 * What is deliberately NOT alerted on:
 *   · minor and patch releases — that is drift, and the dashboard already has it;
 *   · new advisories and deprecations — Dependabot and the nightly scan both
 *     cover those, and duplicating them here would make the feed noise.
 * A new major is the one event that is (a) genuinely breaking, (b) invisible
 * until someone reads a changelog, and (c) something lurq can already narrow to
 * "which exports actually disappear" via the migration brief.
 */
import semver from 'semver';
import { logger } from '../core/logger';
import { insertAlerts } from '../db/alerts';
import type { Database } from '../db/client';
import { reposDeclaring } from '../db/repos';
import type { NewRepoAlertRow, RepoRow } from '../db/schema';
import { declaredDeps } from './drift';

/** The subset of a package row that decides whether a publish is alertable. */
export interface PackageLatest {
  latestVersion: string | null;
}

/**
 * Did this sync move the package onto a new major?
 *
 * Returns the new version, or null. Null for a first-ever sync (no `before`),
 * because a package lurq has only just indexed has not "shipped a breaking
 * change" from anyone's point of view — it has simply appeared.
 *
 * Guarded against going backwards: the registry can hand back an older `latest`
 * during a deprecation or an unpublish, and reporting that as a major release
 * would fire an alert telling people to upgrade to a version behind the one they
 * were already warned about.
 */
export function newMajorRelease(
  before: PackageLatest | null | undefined,
  after: PackageLatest,
): string | null {
  const from = before?.latestVersion;
  const to = after.latestVersion;
  if (!from || !to) return null;
  if (!semver.valid(from) || !semver.valid(to)) return null;
  if (semver.lte(to, from)) return null;
  return semver.major(to) > semver.major(from) ? to : null;
}

/**
 * The alert one repo gets for one release, or null if the repo does not declare
 * the package after all.
 *
 * `inRange` is the field that earns this feature its place next to the drift
 * numbers. A repo pinned `^18` is now one major behind — bad, but static, and the
 * dashboard would have said so tomorrow. A repo on `*` or `>=18` is not behind at
 * all: its next clean install picks the new major up on its own, and no drift
 * figure anywhere expresses that. Those are different emergencies and the row
 * records which one it is.
 */
export function draftAlert(
  repo: RepoRow,
  packageName: string,
  toVersion: string,
): NewRepoAlertRow | null {
  const declared = declaredDeps(repo.manifests ?? []).get(packageName);
  if (!declared) return null;

  // What the last scan measured this repo as resolving to. Read from the stored
  // drift rather than recomputed: the detail list is capped, so a miss here means
  // "not in the top N drifted deps", which is a gap in our data and is recorded
  // as null rather than filled in with the range's floor.
  const fromVersion = repo.drift?.deps.find((d) => d.name === packageName)?.resolved ?? null;

  return {
    ownerId: repo.ownerId,
    repoId: repo.id,
    repoFullName: repo.fullName,
    packageName,
    range: declared.range,
    fromVersion,
    toVersion,
    inRange: semver.satisfies(toVersion, declared.range, { includePrerelease: false }),
  };
}

/**
 * Fan a publish out to every connected repo that depends on the package.
 *
 * Best-effort by contract: the caller is an ingestion path, and failing to write
 * a notification must never fail the package sync that produced it. Returns how
 * many alerts were newly recorded, which is what the watcher logs.
 */
export async function emitPublishAlerts(
  db: Database,
  name: string,
  before: PackageLatest | null | undefined,
  after: PackageLatest,
): Promise<number> {
  const toVersion = newMajorRelease(before, after);
  if (!toVersion) return 0;

  try {
    const affected = await reposDeclaring(db, name);
    if (affected.length === 0) return 0;

    const rows = affected
      .map((repo) => draftAlert(repo, name, toVersion))
      .filter((row): row is NewRepoAlertRow => row !== null);

    const written = await insertAlerts(db, rows);
    if (written > 0) {
      logger.info(`alerts: ${name}@${toVersion} is a new major, notified ${written} repo(s)`);
    }
    return written;
  } catch (err) {
    logger.warn(`alerts: could not fan out ${name}@${toVersion}: ${(err as Error).message}`);
    return 0;
  }
}
