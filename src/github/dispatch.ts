/**
 * Start a repo's upgrade workflow the moment a breaking release lands.
 *
 * The autopilot's cron is weekly, which matches how fast majors actually arrive
 * but says nothing useful about WHEN they arrive. lurq already learns of a
 * publish within seconds (the `_changes` follower) and already knows which
 * connected repos declare that package, and `emitPublishAlerts` already joins
 * those two facts to write an alert row. This turns that row into a run.
 *
 * Why this is not a second cadence knob: the trigger is an event that happened,
 * not a clock. A repo hears about react-router 6→7 on the day it ships instead
 * of up to six days later, and hears nothing at all on the days nothing ships —
 * which is strictly better than both a weekly and a daily poll.
 *
 * The dedup is already Postgres's job. `repo_alerts` has a unique index on
 * (repo, package, version), so `insertAlerts` only ever returns rows that are
 * genuinely new, and one release can only ever produce one dispatch per repo.
 * Nothing here needs its own bookkeeping, which is why this module has no state.
 *
 * REQUIRES `actions: write` on the GitHub App, granted 2026-09-17. Note what it
 * does NOT grant: no contents write, so lurq still cannot rewrite the workflow
 * or set a repository variable — it can only start the file the user committed.
 *
 * If the permission is ever revoked, or an installation has not approved it,
 * every call here returns `permission-denied`, the caller logs it once per
 * release, and the weekly cron keeps working exactly as it does now. No runs
 * are lost, they are just not early — which is why this is safe to call
 * unconditionally rather than behind a feature check.
 */
import { logger } from '../core/logger';
import type { RepoRow } from '../db/schema';
import { GithubAppError, installationPost } from './app';
import { repoMode } from './scope';
import { WORKFLOW_PATH } from './workflow';

/** The file name GitHub addresses a workflow by, from the one path constant. */
const WORKFLOW_FILE = WORKFLOW_PATH.split('/').pop()!;

export type DispatchOutcome =
  | 'dispatched'
  /** The repo's policy is analyse-only, so a run would change nothing. */
  | 'not-armed'
  /** `actions: write` is not granted. Expected until the App is updated. */
  | 'permission-denied'
  /** No workflow committed, or the installation cannot see the repo. */
  | 'no-workflow'
  | 'failed';

/**
 * Should a new major for this repo start a run?
 *
 * Armed only. A `comment`-mode repo would produce a report nobody asked for, on
 * a schedule they did not choose — the user picked a weekly cadence for
 * analysis, and turning that into "whenever anything publishes" is a change to
 * their cadence made on their behalf. An armed repo, by contrast, has already
 * said it wants pull requests, and the only question a dispatch answers is
 * whether it gets one this week or today.
 *
 * Pure, so the policy half of this feature is testable without GitHub.
 */
export function shouldDispatch(repo: RepoRow): boolean {
  return repoMode(repo.policy) !== 'comment';
}

/**
 * Ask GitHub to run the repo's upgrade workflow now.
 *
 * Sends NO inputs on purpose. `workflow_dispatch` would otherwise apply the
 * `mode` input's default and pin the run to whatever was baked into the file,
 * skipping the step that reads the repo's current dashboard setting — so a
 * triggered run must look exactly like a scheduled one. The workflow's own
 * `concurrency` group (cancel-in-progress) handles a dispatch landing while a
 * run is already going.
 *
 * Never throws. This is reached from an ingestion path where a notification
 * failing must not fail the package sync that produced it.
 */
export async function dispatchUpgradeWorkflow(repo: RepoRow): Promise<DispatchOutcome> {
  if (!shouldDispatch(repo)) return 'not-armed';
  try {
    await installationPost(
      repo.installationId,
      `/repos/${repo.fullName}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      { ref: repo.defaultBranch ?? 'main' },
    );
    return 'dispatched';
  } catch (err) {
    if (err instanceof GithubAppError && err.status === 403) return 'permission-denied';
    if (err instanceof GithubAppError && err.status === 404) return 'no-workflow';
    logger.warn(
      `dispatch: could not start a run for ${repo.fullName}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return 'failed';
  }
}

/**
 * Dispatch for each repo that was newly alerted, and report what happened.
 *
 * Sequential for the same reason `scanRepos` is: GitHub's rate limit is per
 * installation and shared, and nothing is waiting on this. `permission-denied`
 * is counted rather than logged per repo — with the permission ungranted that
 * is every armed repo on every release, and a hundred identical warnings is how
 * a log stops being read.
 */
export async function dispatchForAlerts(repos: RepoRow[]): Promise<Record<DispatchOutcome, number>> {
  const tally: Record<DispatchOutcome, number> = {
    dispatched: 0,
    'not-armed': 0,
    'permission-denied': 0,
    'no-workflow': 0,
    failed: 0,
  };
  for (const repo of repos) {
    // Belt and braces: dispatchUpgradeWorkflow already swallows GitHub errors,
    // but `shouldDispatch` reads the stored policy and this runs off an
    // ingestion path. One repo with an unexpected row must not stop the others
    // from hearing about a release.
    try {
      tally[await dispatchUpgradeWorkflow(repo)] += 1;
    } catch (err) {
      tally.failed += 1;
      logger.warn(
        `dispatch: skipped ${repo.fullName}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  if (tally.dispatched > 0) {
    logger.info(`dispatch: started ${tally.dispatched} upgrade run(s) on a new major`);
  }
  if (tally['permission-denied'] > 0) {
    logger.warn(
      `dispatch: ${tally['permission-denied']} run(s) not started — the lurq GitHub App needs Actions: write. ` +
        'The weekly schedule is unaffected.',
    );
  }
  return tally;
}
