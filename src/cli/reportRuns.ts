/**
 * Turn a `check-upgrade` report into the rows the dashboard shows.
 *
 * `POST /upgrade-runs` has existed on the server, with validation, an upsert,
 * and an impact query behind it, since the autopilot shipped — and nothing ever
 * called it. The dashboard's "Upgrade runs" table and its whole impact row
 * (analysed / blocking / call sites) were therefore empty for every real
 * account; only the demo fixtures ever filled them. This module is the missing
 * client.
 *
 * The mapping is pure and lives apart from the posting so it can be tested
 * without a network: everything reported here is already in the report the CI
 * step just printed, so nothing is recomputed and the two can never disagree.
 *
 * What is NOT reported, deliberately: `filesChanged`, `testsPassed`, and the
 * `pr_open`/`merged` statuses. Those describe what the *agent* did after this
 * command ran, and the CLI cannot observe them without guessing. An upgrade the
 * model reverted would be posted as a PR that included it, which is exactly the
 * kind of overstatement `unverified` exists to prevent elsewhere in this file's
 * neighbourhood.
 * ponytail: `checked` only. To fill the PR/merge tiles honestly, a later step
 * would have to diff the opened PR's manifests and report per package.
 */
import type { UpgradeReport, UpgradeTarget } from '../surface/upgrade';
import type { ReportedRun } from './remote';

/** Server cap (db/upgradeRuns.MAX_RUNS_PER_POST); trim here so a large repo's
 *  post isn't silently truncated server-side. */
const MAX_RUNS = 100;

export interface RunContext {
  /** `owner/name`. */
  repoFullName: string;
  /** Permalink to the Actions run these rows came from. Part of the dedup key,
   *  so re-running a job updates its rows instead of doubling every figure. */
  runUrl: string;
}

/** Every reference behind a finding, across removed symbols and arity changes. */
function findingRefs(finding: UpgradeReport['breaking'][number]) {
  return [
    ...finding.symbolsRemoved.flatMap((s) => s.refs),
    ...finding.arityChanged.flatMap((a) => a.refs),
  ];
}

/**
 * Report rows for one checked upgrade set.
 *
 * Every target appears exactly once, in one of four severities. A package the
 * check could not establish comes back `unverified` rather than being dropped:
 * a dashboard that shows only what we managed to check reads as a clean bill of
 * health, and "we did not look" has to stay visible to be worth anything.
 */
export function buildRunReports(
  report: UpgradeReport,
  targets: UpgradeTarget[],
  ctx: RunContext,
): ReportedRun[] {
  const versions = new Map(targets.map((t) => [t.package, t]));
  const base = (pkg: string) => {
    const target = versions.get(pkg);
    return {
      repoFullName: ctx.repoFullName,
      packageName: pkg,
      fromVersion: target?.fromVersion ?? '',
      toVersion: target?.toVersion ?? '',
      status: 'checked' as const,
      runUrl: ctx.runUrl,
    };
  };

  const rows: ReportedRun[] = [];

  for (const finding of report.breaking) {
    const refs = findingRefs(finding);
    rows.push({
      ...base(finding.package),
      // The finding carries its own versions; prefer them over the target map.
      fromVersion: finding.fromVersion,
      toVersion: finding.toVersion,
      severity: finding.severity,
      symbolsAffected: [
        ...finding.symbolsRemoved.map((s) => s.symbol),
        ...finding.arityChanged.map((a) => a.symbol),
      ],
      callSites: refs.length,
      callSiteFiles: [...new Set(refs.map((r) => r.file))],
    });
  }

  for (const pkg of report.ok) rows.push({ ...base(pkg), severity: 'ok' });
  for (const u of report.unverified) rows.push({ ...base(u.package), severity: 'unverified' });

  // A row with no versions cannot be deduped or displayed usefully, and the
  // server would reject it anyway (parseUpgradeRun requires both).
  return rows.filter((r) => r.fromVersion && r.toVersion).slice(0, MAX_RUNS);
}

/**
 * Where this run lives, from the Actions environment.
 *
 * Returns null off a runner. Reporting is for CI: on a laptop there is no run to
 * attribute rows to, and inventing one would put junk in the dedup key.
 */
export function runContextFromEnv(env: NodeJS.ProcessEnv = process.env): RunContext | null {
  const repoFullName = env.GITHUB_REPOSITORY?.trim();
  if (!repoFullName) return null;
  const server = env.GITHUB_SERVER_URL?.trim() || 'https://github.com';
  const runId = env.GITHUB_RUN_ID?.trim();
  // The run URL is part of the dedup key. Without a run id there is nothing
  // stable to key on, so leave it empty rather than fabricate a URL that would
  // make every job look like a different run and multiply the totals.
  return { repoFullName, runUrl: runId ? `${server}/${repoFullName}/actions/runs/${runId}` : '' };
}
