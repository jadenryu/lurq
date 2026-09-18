/**
 * `lurq autopilot-init` — write the autopilot workflow into this checkout.
 *
 * Until now the only way to get this file was the dashboard: it is rendered per
 * repo by `/repos/:id`, and the user copied it into GitHub's new-file page by
 * hand. That made the workflow the one setup step an agent could not do, and it
 * is why "set up everything with one paste" was impossible — a prompt had
 * nothing to hand the agent except two hundred lines of YAML to transcribe
 * exactly.
 *
 * Rendering locally removes that. The package manager comes from the lockfile
 * actually on disk rather than from a tree read, which is strictly better
 * information, and `renderWorkflow` imports nothing but `core/constants`, so it
 * ships in the public bundle.
 *
 * The mode is NOT baked in beyond a default, and that is what makes rendering
 * without the dashboard safe: the file reads the repository's mode from the
 * plan response on every run (see the "Resolve mode" step), so a file written
 * here still obeys whatever the dashboard says later. Writing it does not arm
 * anything on its own.
 *
 * Same discipline as `mcp-ci`, which is the precedent for this shape: refuse to
 * clobber without `--force`, print the path written, then print the repository
 * secrets to add — because a committed workflow with no `LURQ_API_KEY` fails on
 * its first run for a reason the file itself cannot explain.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { bold, dim, yellow } from './format';
import { detectInstallCommand, renderWorkflow, WORKFLOW_PATH } from '../github/workflow';

export interface AutopilotInitOpts {
  /** Print the workflow instead of writing it. */
  print?: boolean;
  /** Replace an existing workflow file. */
  force?: boolean;
  /** Cron schedule. Default: the weekly one `renderWorkflow` picks. */
  cron?: string;
  /**
   * What the file does until the dashboard says otherwise.
   *
   * `fix` by default, not `pr`: `fix` opens pull requests using only changes
   * the package itself proves and needs no Anthropic credential, so it is the
   * mode that cannot fail for want of a key. `pr` is an explicit upgrade.
   */
  mode?: 'comment' | 'fix' | 'pr';
  /** Emit the auto-merge step. Off unless asked, like the dashboard's policy. */
  autoMerge?: boolean;
}

/**
 * Lockfiles at the root of a checkout, newest-first by preference.
 *
 * `detectInstallCommand` takes filenames and is fed from a GitHub tree
 * elsewhere; nothing produced that list from a local directory, so this does.
 * Root only, matching the tree reader: a nested lockfile belongs to a
 * workspace, not to the repository.
 */
export function rootLockfiles(root: string): string[] {
  const names = [
    'pnpm-lock.yaml',
    'yarn.lock',
    'bun.lockb',
    'bun.lock',
    'package-lock.json',
  ];
  return names.filter((name) => existsSync(join(root, name)));
}

/** The workflow this checkout should get, package manager and all. */
export function autopilotWorkflow(root: string, opts: AutopilotInitOpts = {}): string {
  return renderWorkflow({
    installCommand: detectInstallCommand(rootLockfiles(root)),
    mode: opts.mode ?? 'fix',
    ...(opts.cron ? { cron: opts.cron } : {}),
    ...(opts.autoMerge ? { autoMerge: true } : {}),
  });
}

export async function runAutopilotInit(
  dir: string | undefined,
  opts: AutopilotInitOpts = {},
): Promise<void> {
  const root = resolve(dir ?? process.cwd());
  const yaml = autopilotWorkflow(root, opts);

  if (opts.print) {
    process.stdout.write(yaml);
    return;
  }

  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  const target = join(root, WORKFLOW_PATH);
  if (existsSync(target) && !opts.force) {
    throw new Error(`${WORKFLOW_PATH} already exists; pass --force to replace it`);
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, yaml);

  console.log(`wrote ${WORKFLOW_PATH}`);

  if (rootLockfiles(root).length === 0) {
    // Said plainly rather than left to fail in CI: with no lockfile the install
    // step falls back to `npm install`, which is right for a repo that has
    // none and wrong for a pnpm repo whose lockfile simply is not committed.
    console.log(
      yellow('no lockfile at the root, so the install step uses `npm install`; pass --print and edit if that is wrong'),
    );
  }

  console.log('add these repository secrets:');
  console.log(`  ${bold('LURQ_API_KEY')}  ${dim('required: lets the job ask which upgrades are outstanding')}`);
  if ((opts.mode ?? 'fix') === 'pr') {
    console.log(
      `  ${bold('ANTHROPIC_API_KEY')} ${dim('or')} ${bold('CLAUDE_CODE_OAUTH_TOKEN')}  ${dim('pr mode only, for the agent step')}`,
    );
  } else {
    console.log(
      dim('  no Anthropic credential needed: this file opens pull requests using only what lurq can prove'),
    );
  }
  console.log(dim('nothing runs until you commit the file; the dashboard governs the mode from then on'));
}
