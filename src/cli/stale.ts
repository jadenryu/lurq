/**
 * `lurq stale` — what your coding agent is confidently wrong about.
 *
 * Every other command in lurq answers "what breaks if I upgrade". This one
 * answers the question a team running agents actually has: the model writing
 * our code learned an API that has since moved, so where is it going to be
 * wrong? The answer is a diff between the surface that was current at the
 * model's knowledge cutoff and the surface you have installed.
 *
 * Reads resolved versions from the lockfile or node_modules rather than the
 * declared ranges. "^6.0.0" is not a fact about what the agent will hit; the
 * installed 6.4.2 is.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readManifests, mergedDeps } from './upgradePlan';
import { fetchStale, type RemoteOptions } from './remote';
import {
  CUTOFFS_AS_OF,
  cutoffTableAgeDays,
  cutoffTableIsStale,
  resolveSince,
} from '../fix/modelCutoffs';
import type { StalenessReport } from '../surface/staleness';
import { bold, dim, yellow } from './format';
import { logger } from '../core/logger';

export interface StaleOpts extends RemoteOptions {
  model?: string;
  since?: string;
  json?: boolean;
}

/**
 * What each dependency actually resolves to on disk.
 *
 * `node_modules/<name>/package.json` is the ground truth — it is what the
 * agent's code will run against. Packages that are declared but not installed
 * are skipped rather than guessed at from their range.
 */
export function resolveInstalled(
  dir: string,
  names: string[],
): { installed: { name: string; version: string }[]; missing: string[] } {
  const installed: { name: string; version: string }[] = [];
  const missing: string[] = [];
  for (const name of names) {
    const manifest = join(dir, 'node_modules', ...name.split('/'), 'package.json');
    if (!existsSync(manifest)) {
      missing.push(name);
      continue;
    }
    try {
      const version = (JSON.parse(readFileSync(manifest, 'utf8')) as { version?: unknown }).version;
      if (typeof version === 'string') installed.push({ name, version });
      else missing.push(name);
    } catch {
      missing.push(name);
    }
  }
  return { installed, missing };
}

/** One line per package, worst first, then the headline. */
export function formatStale(report: StalenessReport, basis: string): string {
  const total = report.beliefs.reduce((n, b) => n + b.removed.length, 0);
  const lines: string[] = [];

  if (total === 0) {
    lines.push(
      `Nothing stale. Every installed dependency still exports what it did at ${report.since}.`,
    );
  } else {
    lines.push(
      bold(
        `${total} API${total === 1 ? '' : 's'} your agent believes in ${
          total === 1 ? 'is' : 'are'
        } gone`,
      ),
      dim(`measured against ${basis}`),
      '',
    );
    for (const belief of report.beliefs) {
      lines.push(
        `${bold(belief.package)} ${dim(`${belief.believed} → ${belief.installed}`)}  ${
          belief.removed.length
        } removed`,
      );
      const shown = belief.removed.slice(0, 6);
      for (const symbol of shown) {
        const rename = belief.renamed.find((r) => r.from === symbol);
        lines.push(`  ${symbol}${rename ? dim(`  → ${rename.to.join(', ')}`) : ''}`);
      }
      if (belief.removed.length > shown.length) {
        lines.push(dim(`  +${belief.removed.length - shown.length} more`));
      }
      lines.push('');
    }
  }

  // Said plainly, because a count that silently excludes packages is a count
  // nobody should act on.
  if (report.unassessed.length > 0) {
    lines.push(
      dim(
        `${report.unassessed.length} package(s) not diffed — surfaces not extracted yet, so nothing is claimed about them. Retry shortly.`,
      ),
    );
  }
  if (report.newerThanModel.length > 0) {
    lines.push(
      dim(
        `${report.newerThanModel.length} package(s) published after the cutoff — the model never saw them at all.`,
      ),
    );
  }
  return lines.join('\n');
}

export async function runStale(dir: string, opts: StaleOpts): Promise<void> {
  const since = resolveSince({ model: opts.model, since: opts.since });
  if ('error' in since) {
    logger.error(since.error);
    process.exitCode = 1;
    return;
  }

  // A table older than its shelf life will be missing the model the caller is
  // actually using. Say so rather than answering quietly from stale data —
  // which is the exact failure this command exists to report.
  if (!opts.since && cutoffTableIsStale()) {
    logger.warn(
      yellow(
        `The model cutoff table was last refreshed ${CUTOFFS_AS_OF} (${cutoffTableAgeDays()} days ago). Upgrade lurq, or pass --since.`,
      ),
    );
  }

  const declared = mergedDeps(readManifests(dir));
  const names = Object.keys(declared);
  if (names.length === 0) {
    logger.error(`No package.json with dependencies found under ${dir}`);
    process.exitCode = 1;
    return;
  }

  const { installed, missing } = resolveInstalled(dir, names);
  if (installed.length === 0) {
    logger.error('No installed versions found. Run your package manager first, then this again.');
    process.exitCode = 1;
    return;
  }

  const report = await fetchStale<StalenessReport>(installed, since.date, opts);

  if (opts.json) {
    logger.info(JSON.stringify({ ...report, basis: since.basis, notInstalled: missing }, null, 2));
    return;
  }
  logger.info(formatStale(report, since.basis));
  if (missing.length > 0) {
    logger.info(dim(`${missing.length} declared package(s) are not installed and were skipped.`));
  }
}
