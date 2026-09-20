/**
 * `lurq autopilot-init`, which renders the autopilot workflow locally.
 *
 * This command is what makes agent-driven setup possible: the file used to
 * exist only on the dashboard, rendered per repo, so writing it was the one
 * step a shell could not do and a prompt could only paste verbatim.
 *
 * The property worth pinning is that rendering locally is not a downgrade. The
 * package manager comes from the lockfile actually on disk, which is better
 * information than the tree read the dashboard uses — and a repo with no
 * lockfile must fall back rather than guess.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { autopilotWorkflow, rootLockfiles } from '../src/cli/autopilotInit';
import { WORKFLOW_PATH } from '../src/github/workflow';

/** A throwaway checkout containing exactly the files named. */
function checkout(...files: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'lurq-autopilot-'));
  for (const file of files) writeFileSync(join(root, file), '');
  return root;
}

describe('rootLockfiles', () => {
  it('finds each package manager lockfile', () => {
    expect(rootLockfiles(checkout('pnpm-lock.yaml'))).toEqual(['pnpm-lock.yaml']);
    expect(rootLockfiles(checkout('yarn.lock'))).toEqual(['yarn.lock']);
    expect(rootLockfiles(checkout('package-lock.json'))).toEqual(['package-lock.json']);
  });

  it('ignores a nested lockfile, which belongs to a workspace', () => {
    // Matching the tree reader in manifests.ts: a lockfile under packages/* is
    // not the repository's package manager.
    const root = checkout('package.json');
    mkdirSync(join(root, 'packages', 'api'), { recursive: true });
    writeFileSync(join(root, 'packages', 'api', 'pnpm-lock.yaml'), '');
    expect(rootLockfiles(root)).toEqual([]);
  });

  it('returns nothing for a checkout with no lockfile', () => {
    expect(rootLockfiles(checkout('package.json'))).toEqual([]);
  });
});

describe('autopilotWorkflow', () => {
  it('uses the package manager the checkout actually has', () => {
    expect(autopilotWorkflow(checkout('pnpm-lock.yaml'))).toContain(
      'pnpm install --frozen-lockfile',
    );
    expect(autopilotWorkflow(checkout('yarn.lock'))).toContain('yarn install --frozen-lockfile');
    expect(autopilotWorkflow(checkout('package-lock.json'))).toContain('npm ci');
  });

  it('falls back to npm install with no lockfile, because npm ci would fail', () => {
    expect(autopilotWorkflow(checkout('package.json'))).toContain('npm install');
  });

  it('defaults to fix mode, the one that needs no Anthropic credential', () => {
    // `pr` cannot be a default: its credential check exits 1 without a key, so
    // a file written by an agent would fail on its first run.
    const yaml = autopilotWorkflow(checkout('package-lock.json'));
    expect(yaml).toContain("*) MODE='fix' ;;");
  });

  it('still reads the mode at run time, so writing it arms nothing by itself', () => {
    // This is what makes local rendering safe without the dashboard: the file
    // asks for the repository's current mode on every run.
    const yaml = autopilotWorkflow(checkout('package-lock.json'));
    expect(yaml).toContain('Resolve mode');
    expect(yaml).toContain("vars.LURQ_MODE || '' }}");
  });

  it('honours an explicit mode and cron', () => {
    const yaml = autopilotWorkflow(checkout('package-lock.json'), {
      mode: 'comment',
      cron: '0 5 * * *',
    });
    expect(yaml).toContain("*) MODE='comment' ;;");
    expect(yaml).toContain('cron: "0 5 * * *"');
  });

  it('emits no auto-merge step unless asked', () => {
    const plain = autopilotWorkflow(checkout('package-lock.json'));
    expect(plain).not.toContain('gh pr merge');
    expect(autopilotWorkflow(checkout('package-lock.json'), { autoMerge: true })).toContain(
      'gh pr merge --auto',
    );
  });

  it('keeps the permissions block minimal, wherever it was rendered', () => {
    // The trust boundary does not widen just because a CLI wrote the file.
    const yaml = autopilotWorkflow(checkout('package-lock.json'));
    const block = yaml.slice(yaml.indexOf('permissions:'), yaml.indexOf('concurrency:'));
    expect(block).toContain('contents: write');
    expect(block).toContain('pull-requests: write');
    expect(block).not.toContain('actions:');
    expect(block).not.toContain('id-token:');
  });

  it('writes to the same path the dashboard names', () => {
    // One constant, so the CLI and the dashboard cannot disagree about where
    // the file lives — a mismatch would give a repo two workflows.
    expect(WORKFLOW_PATH).toBe('.github/workflows/lurq-upgrade.yml');
  });
});
