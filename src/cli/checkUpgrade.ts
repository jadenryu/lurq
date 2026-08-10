/**
 * `lurq check-upgrade` — the CI gate.
 *
 * Narrows an upgrade plan down to what this codebase actually references. The
 * plan says react-router 6→8 removes `useHistory`; this says whether *you* call
 * it, and where. That intersection is the product, and it deliberately runs
 * where the source already is: nothing read here is ever transmitted.
 *
 * It also needs no lurq API key and no test suite. Surfaces come straight from
 * the npm tarballs of both versions, so the gate keeps working when our API is
 * down, and it catches breakage in code no test covers — which is precisely the
 * gap that lets a green Dependabot PR fail in production.
 */
import { readFileSync } from 'node:fs';
import type { UpgradeTarget } from '../surface/upgrade';

/** `pkg@from..to`, the repeatable `--upgrade` form. */
export function parseUpgradeSpec(spec: string): UpgradeTarget {
  const at = spec.lastIndexOf('@');
  const name = spec.slice(0, at);
  const [fromVersion, toVersion] = spec.slice(at + 1).split('..');
  if (!name || !fromVersion || !toVersion) {
    throw new Error(`bad --upgrade '${spec}', expected pkg@from..to`);
  }
  return { package: name, fromVersion, toVersion };
}

/** Shape of the `upgrade-plan --json` file, as far as this command cares. */
interface PlanFile {
  upgrades?: {
    package: string;
    fromVersion: string;
    toVersion: string;
    /** Repo-policy eligibility, when the plan was governed. */
    inScope?: boolean;
  }[];
}

/** Read targets from a plan produced by `lurq upgrade-plan --json`. */
export function targetsFromPlanFile(path: string): UpgradeTarget[] {
  // A plan file is written by one command and read by another, usually across
  // two CI steps. When step one fails the file is missing or empty, and the bare
  // `Unexpected end of JSON input` that fell out of JSON.parse named neither the
  // file nor the step that should have written it.
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    const why = (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'does not exist' : String(err);
    throw new Error(`plan file ${path} ${why}. Did \`lurq upgrade-plan --json\` run?`);
  }
  if (!text.trim()) {
    throw new Error(`plan file ${path} is empty. Did \`lurq upgrade-plan --json\` run?`);
  }
  let parsed: PlanFile;
  try {
    parsed = JSON.parse(text) as PlanFile;
  } catch (err) {
    throw new Error(`plan file ${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed.upgrades)) {
    throw new Error(`${path} is not an upgrade plan (no "upgrades" array)`);
  }
  return parsed.upgrades
    .filter((u) => u.package && u.fromVersion && u.toVersion)
    // `!== false` rather than a truthy test: a plan from a server that predates
    // scope enforcement has no `inScope` key at all, and an absent policy must
    // mean "ungoverned", never "excluded". Getting this backwards would empty
    // the brief on every older deployment.
    .filter((u) => u.inScope !== false)
    .map((u) => ({ package: u.package, fromVersion: u.fromVersion, toVersion: u.toVersion }));
}

export interface CheckUpgradeOpts {
  upgrade?: string[];
  plan?: string;
  json?: boolean;
  exitCode?: boolean;
  /** Post what this run concluded to the dashboard (CI only; needs an API key). */
  report?: boolean;
  url?: string;
  apiKey?: string;
}

/**
 * Post the report, and never let doing so change the outcome of the check.
 *
 * Reporting is telemetry hung off a gate whose entire value is that it works
 * with no API key, no network to us, and no test suite. A failure here — no key,
 * our API down, a runner with no egress — must therefore degrade to a printed
 * line on stderr and nothing else. Failing the build because a dashboard write
 * did not land would trade the feature for the thing it is decorating.
 */
async function reportOutcome(
  report: Awaited<ReturnType<typeof import('../surface/upgrade')['checkUpgrade']>>,
  targets: UpgradeTarget[],
  opts: CheckUpgradeOpts,
): Promise<void> {
  const { buildRunReports, runContextFromEnv } = await import('./reportRuns');
  const ctx = runContextFromEnv();
  if (!ctx) {
    console.error('--report: no $GITHUB_REPOSITORY, so there is no run to attribute this to. Skipped.');
    return;
  }
  const runs = buildRunReports(report, targets, ctx);
  if (runs.length === 0) return;
  try {
    const { reportUpgradeRuns } = await import('./remote');
    const { recorded, rejected } = await reportUpgradeRuns(runs, {
      url: opts.url,
      apiKey: opts.apiKey,
    });
    console.error(
      `reported ${recorded} upgrade result(s) to the lurq dashboard` +
        (rejected ? ` (${rejected} rejected)` : ''),
    );
  } catch (err) {
    // A missing key and an unreachable API are both non-fatal here, but they
    // need different sentences: one is "add LURQ_API_KEY to your repo secrets",
    // the other is "nothing for you to do". Reporting both as "could not reach"
    // is how a fixable setup mistake looks like our outage.
    const message = err instanceof Error ? err.message : String(err);
    const noKey = /no api key/i.test(message);
    console.error(
      noKey
        ? '--report: no API key, so there was nothing to report with. Set LURQ_API_KEY in this repository\'s secrets to see these results on your dashboard. The check itself is unaffected.'
        : `--report: could not reach the lurq dashboard (${message}). The check itself is unaffected.`,
    );
  }
}

export async function runCheckUpgrade(dir: string, opts: CheckUpgradeOpts): Promise<void> {
  const { scanReferences } = await import('../surface/references');
  const { checkUpgrade, formatUpgradeReport } = await import('../surface/upgrade');

  const targets = [
    ...(opts.plan ? targetsFromPlanFile(opts.plan) : []),
    ...(opts.upgrade ?? []).map(parseUpgradeSpec),
  ];
  if (targets.length === 0) {
    // An empty plan is a legitimate "nothing to do", not a usage error — CI must
    // not fail a scheduled run just because the repo is already up to date.
    if (opts.plan) {
      const empty = { safe: true, breaking: [], ok: [], unverified: [] };
      console.log(opts.json ? JSON.stringify(empty, null, 2) : 'Nothing to check.');
      return;
    }
    throw new Error('give --plan <file> or at least one --upgrade pkg@from..to');
  }

  const refs = scanReferences(dir);
  const report = await checkUpgrade(targets, refs);

  console.log(
    opts.json
      ? JSON.stringify(report, null, 2)
      : formatUpgradeReport(report, `upgrade check on ${dir}`),
  );
  // Before the exit code, so the report lands even on a run this gate fails —
  // a blocked upgrade is the single most useful row the dashboard can show.
  if (opts.report) await reportOutcome(report, targets, opts);
  if (opts.exitCode && !report.safe) process.exitCode = 1;
}
