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
  upgrades?: { package: string; fromVersion: string; toVersion: string }[];
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
    .map((u) => ({ package: u.package, fromVersion: u.fromVersion, toVersion: u.toVersion }));
}

export interface CheckUpgradeOpts {
  upgrade?: string[];
  plan?: string;
  json?: boolean;
  exitCode?: boolean;
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
  if (opts.exitCode && !report.safe) process.exitCode = 1;
}
