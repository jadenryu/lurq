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
import { cliUpgradeWatchers, insertAlerts, type CliWatcher } from '../db/alerts';
import type { Database } from '../db/client';
import { reposDeclaring, reposDeclaringForOwner } from '../db/repos';
import type { NewRepoAlertRow, RepoRow } from '../db/schema';
import { declaredDeps } from './drift';
import type { SurfaceDiff } from '../surface/diff';
import { dispatchForAlerts } from './dispatch';

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
    // `satisfies` throws on the non-semver ranges npm accepts (`latest`,
    // `workspace:*`, `file:../x`), and this runs off the publish feed — one such
    // dependency would take down alerting for that release across every repo.
    //
    // False means "we could not establish that this range admits the new
    // version", not "it is safe". Same discipline as everywhere else here: not
    // knowing is never evidence.
    inRange: semver.validRange(declared.range)
      ? semver.satisfies(toVersion, declared.range, { includePrerelease: false })
      : false,
  };
}

/**
 * The alert an account with no connected repo gets, or null when its last
 * upgrade already reached this major.
 *
 * All lurq knows about such a repo is the version `check-upgrade` last took it
 * to, so that is both `range` and `fromVersion`, and `inRange` is false: we
 * cannot tell whether its declared range would take the new major, and not
 * knowing is never evidence. Those alerts reach the feed, channels and the
 * weekly digest, never the urgent "installs on its own" email.
 */
export function draftCliAlert(
  watcher: CliWatcher,
  packageName: string,
  toVersion: string,
): NewRepoAlertRow | null {
  const last =
    semver.valid(watcher.lastToVersion) ?? semver.coerce(watcher.lastToVersion)?.version ?? null;
  if (last && semver.major(last) >= semver.major(toVersion)) return null;
  return {
    ownerId: watcher.ownerId,
    repoId: null,
    repoFullName: watcher.repoFullName,
    packageName,
    range: watcher.lastToVersion,
    fromVersion: watcher.lastToVersion,
    toVersion,
    inRange: false,
  };
}

/**
 * Fan a publish out to every repo that depends on the package: connected repos
 * from their stored manifests, and CLI-only repos from their recent upgrade
 * runs. A repo that is both is alerted once, as the connected repo.
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
    const [affected, watchers] = await Promise.all([
      reposDeclaring(db, name),
      cliUpgradeWatchers(db, name),
    ]);
    const connected = new Set(affected.map((r) => `${r.ownerId}\u0000${r.fullName}`));

    const rows = [
      ...affected.map((repo) => draftAlert(repo, name, toVersion)),
      ...watchers
        .filter((w) => !connected.has(`${w.ownerId}\u0000${w.repoFullName}`))
        .map((w) => draftCliAlert(w, name, toVersion)),
    ].filter((row): row is NewRepoAlertRow => row !== null);
    if (rows.length === 0) return 0;

    const inserted = await insertAlerts(db, rows);
    if (inserted.length > 0) {
      logger.info(
        `alerts: ${name}@${toVersion} is a new major, notified ${inserted.length} repo(s)`,
      );
    }

    // Turn the alerts that are actually new into runs, so an armed repo hears
    // about a breaking release the day it ships rather than up to six days
    // later. `insertAlerts` returns only genuinely inserted rows — the unique
    // index on (repo, package, version) drops the rest — so a re-sync of an
    // already-alerted publish dispatches nothing and this needs no bookkeeping
    // of its own.
    //
    // Connected repos only: a CLI watcher's alert has no `repoId` and no
    // installation to dispatch through, so it falls out of this lookup.
    const byId = new Map(affected.map((repo) => [repo.id, repo]));
    const freshlyAlerted = inserted
      .map((row) => (row.repoId === null ? undefined : byId.get(row.repoId)))
      .filter((repo): repo is RepoRow => repo !== undefined);
    if (freshlyAlerted.length > 0) await dispatchForAlerts(freshlyAlerted);

    return inserted.length;
  } catch (err) {
    logger.warn(`alerts: could not fan out ${name}@${toVersion}: ${(err as Error).message}`);
    return 0;
  }
}

/**
 * How many removed exports a private alert names before it summarises. Enough
 * to act on, short enough to survive a Slack line and an email row.
 */
const NAMED_REMOVALS = 5;

/**
 * One sentence saying what this publish took away.
 *
 * Renames come first and are worth the space: a proven rename is not "your
 * code is broken", it is "your code is broken and here is the replacement",
 * and it is the only line in the feed an agent can act on without reading
 * anything else.
 */
/**
 * Ranges that resolve to a local checkout rather than to the registry.
 *
 * These are the normal way a monorepo declares an internal dependency, and
 * `semver.validRange` rejects every one of them — which `draftAlert` correctly
 * reads as "could not establish that this range admits the new version".
 *
 * For a PRIVATE publish that reading is backwards. `workspace:*` does not mean
 * "we might pick this up"; it means the consumer is already building against
 * the very package that just changed. It is the strongest in-range case there
 * is, not the weakest, and left at false the alert is filtered out of email, out
 * of the agent notice, and out of any channel at its default `high` threshold —
 * silently, for exactly the repos this feature exists to serve.
 *
 * Deliberately NOT applied to public publishes: there, `workspace:*` means the
 * repo is consuming its own local copy and a registry release does not reach it
 * at all. Same string, opposite meaning, so the override lives here and not in
 * `draftAlert`.
 */
const LOCAL_PROTOCOL = /^(workspace|link|file|portal):/i;

export function describeSurfaceBreak(diff: SurfaceDiff): string | null {
  // A refused diff has empty arrays by contract; never read them as "nothing
  // changed" (§6.4.2 — an empty surface is a measurement gap, not a removal).
  if (diff.inconclusive) return null;

  // A rename IS a removal — the old name is gone — so naming it twice would
  // report the same break as two. The rename wins, because it carries the fix.
  const renamedPaths = new Set(diff.renamed.map((r) => r.path));
  const renamed = diff.renamed.map((r) => `${r.path} → ${r.to.join(' or ')}`);
  const removed = diff.removed.map((s) => s.path).filter((p) => !renamedPaths.has(p));
  const parts: string[] = [];

  if (renamed.length) parts.push(`renamed ${cap(renamed)}`);
  if (removed.length) parts.push(`removed ${cap(removed)}`);
  if (diff.arityChanged.length)
    parts.push(`changed the parameters of ${cap(diff.arityChanged.map((a) => a.path))}`);
  // Type-only removals break `tsc` and not `node`, so they are named as such
  // rather than folded into the removal count (§8.1).
  if (diff.typeOnlyRemoved.length)
    parts.push(`removed the type(s) ${cap(diff.typeOnlyRemoved.map((s) => s.path))}`);

  if (parts.length === 0) return null;
  return `${diff.toVersion ?? 'the new version'} ${parts.join('; ')}.`;
}

const cap = (names: string[]): string => {
  const shown = names.slice(0, NAMED_REMOVALS);
  const more = names.length - shown.length;
  return shown.join(', ') + (more > 0 ? ` and ${more} more` : '');
};

/**
 * Fan a PRIVATE publish out to the publisher's own repos that declare it.
 *
 * The public path infers breakage from a version number — a new major landed,
 * so something probably broke. This one measures it: the author just published
 * a surface, lurq already holds the one before it, and the diff between them
 * says exactly what disappeared. Two consequences follow.
 *
 * First, a removal shipped as a PATCH is alertable here, and is invisible to
 * the version-number path. Internal packages do that constantly, because there
 * is no public contract making anyone careful.
 *
 * Second, the trigger is evidence rather than a heuristic, so a major that
 * removed nothing correctly produces no alert at all.
 *
 * Owner-scoped throughout: unlike the watcher, this runs on a request and must
 * never reach across accounts. Best-effort by contract — the surface is already
 * stored, and failing to notify must not fail the publish that earned it.
 */
export async function emitPrivateSurfaceAlerts(
  db: Database,
  ownerId: string,
  name: string,
  toVersion: string,
  diff: SurfaceDiff,
): Promise<number> {
  const detail = describeSurfaceBreak(diff);
  if (!detail) return 0;

  try {
    const affected = await reposDeclaringForOwner(db, ownerId, name);
    const rows = affected
      .map((repo) => draftAlert(repo, name, toVersion))
      .filter((row): row is NewRepoAlertRow => row !== null)
      .map((row) => ({
        ...row,
        detail,
        inRange: row.inRange || LOCAL_PROTOCOL.test(row.range),
      }));
    if (rows.length === 0) return 0;

    const inserted = await insertAlerts(db, rows);
    if (inserted.length > 0) {
      logger.info(
        `alerts: private ${name}@${toVersion} broke its surface, notified ${inserted.length} repo(s)`,
      );
      const byId = new Map(affected.map((repo) => [repo.id, repo]));
      const fresh = inserted
        .map((row) => (row.repoId === null ? undefined : byId.get(row.repoId)))
        .filter((repo): repo is RepoRow => repo !== undefined);
      if (fresh.length > 0) await dispatchForAlerts(fresh);
    }
    return inserted.length;
  } catch (err) {
    logger.warn(
      `alerts: could not fan out private ${name}@${toVersion}: ${(err as Error).message}`,
    );
    return 0;
  }
}
