import { describe, it, expect } from 'vitest';
import { parseDepsInput, parseUpgradeRun, parseUpgradeRuns } from '../src/github/runs';
import { detectInstallCommand, renderWorkflow, WORKFLOW_PATH } from '../src/github/workflow';
import { mergedDeps } from '../src/cli/upgradePlan';
import { parseUpgradeSpec } from '../src/cli/checkUpgrade';

const valid = {
  repoFullName: 'acme/web',
  packageName: 'react-router',
  fromVersion: '6.9.2',
  toVersion: '8.1.0',
  severity: 'blocking',
  status: 'pr_open',
};

describe('parseUpgradeRun', () => {
  it('accepts a well-formed run', () => {
    expect(parseUpgradeRun(valid)).toMatchObject({ ...valid, callSites: 0, runUrl: '' });
  });

  it('rejects an unknown severity or status rather than coercing it', () => {
    expect(parseUpgradeRun({ ...valid, severity: 'catastrophic' })).toBeNull();
    expect(parseUpgradeRun({ ...valid, status: 'merged-ish' })).toBeNull();
  });

  it('rejects a run missing required identity fields', () => {
    expect(parseUpgradeRun({ ...valid, repoFullName: '' })).toBeNull();
    expect(parseUpgradeRun({ ...valid, toVersion: undefined })).toBeNull();
    expect(parseUpgradeRun(null)).toBeNull();
  });

  it('ignores a caller-supplied ownerId — identity comes from the API key', () => {
    const parsed = parseUpgradeRun({ ...valid, ownerId: 'user_someone_else' });
    expect(parsed).not.toBeNull();
    expect(parsed as unknown as Record<string, unknown>).not.toHaveProperty('ownerId');
  });

  it('distinguishes "did not share paths" from "no paths"', () => {
    expect(parseUpgradeRun(valid)!.callSiteFiles).toBeNull();
    expect(parseUpgradeRun({ ...valid, callSiteFiles: [] })!.callSiteFiles).toEqual([]);
  });

  it('caps list lengths so one post cannot write unbounded data', () => {
    const parsed = parseUpgradeRun({
      ...valid,
      symbolsAffected: Array.from({ length: 5000 }, (_, i) => `sym${i}`),
    });
    expect(parsed!.symbolsAffected.length).toBeLessThanOrEqual(200);
  });

  it('rejects negative and non-integer counts instead of storing NaN', () => {
    expect(parseUpgradeRun({ ...valid, callSites: -5 })!.callSites).toBe(0);
    expect(parseUpgradeRun({ ...valid, filesChanged: 'lots' })!.filesChanged).toBeNull();
  });

  it('keeps testsPassed tri-state: true, false, and "no suite"', () => {
    expect(parseUpgradeRun({ ...valid, testsPassed: false })!.testsPassed).toBe(false);
    expect(parseUpgradeRun(valid)!.testsPassed).toBeNull();
  });
});

describe('parseUpgradeRuns', () => {
  it('keeps the valid entries and counts the rejects', () => {
    const { runs, rejected } = parseUpgradeRuns([valid, { junk: true }, valid], 10);
    expect(runs).toHaveLength(2);
    expect(rejected).toBe(1);
  });

  it('honours the batch cap', () => {
    const { runs } = parseUpgradeRuns(Array.from({ length: 50 }, () => valid), 10);
    expect(runs).toHaveLength(10);
  });
});

describe('parseDepsInput', () => {
  it('keeps string ranges and drops everything else', () => {
    expect(parseDepsInput({ zod: '^3.0.0', bad: 42, worse: null })).toEqual({ zod: '^3.0.0' });
  });

  it('returns an empty map for a non-object', () => {
    expect(parseDepsInput('zod@3')).toEqual({});
  });
});

describe('detectInstallCommand', () => {
  it('picks the command matching the lockfile', () => {
    expect(detectInstallCommand(['pnpm-lock.yaml'])).toBe('pnpm install --frozen-lockfile');
    expect(detectInstallCommand(['yarn.lock'])).toBe('yarn install --frozen-lockfile');
    expect(detectInstallCommand(['package-lock.json'])).toBe('npm ci');
  });

  it('falls back to npm install when there is no lockfile — `npm ci` would fail', () => {
    expect(detectInstallCommand(['package.json'])).toBe('npm install');
  });
});

describe('renderWorkflow', () => {
  it('defaults to analyse-only so connecting a repo never edits it', () => {
    const yaml = renderWorkflow();
    expect(yaml).toContain("default: comment");
    expect(yaml).toContain("|| 'comment'");
  });

  it('grants no permission beyond branch + PR writes', () => {
    const yaml = renderWorkflow();
    const block = yaml.slice(yaml.indexOf('permissions:'), yaml.indexOf('concurrency:'));
    expect(block).toContain('contents: write');
    expect(block).toContain('pull-requests: write');
    // A token that can rewrite CI config or publish packages is not needed here,
    // and the workflow file is the only thing bounding what the job can do.
    expect(block).not.toContain('actions:');
    expect(block).not.toContain('packages:');
    expect(block).not.toContain('id-token:');
  });

  it('denies the agent git and network tools — the workflow does version control', () => {
    const yaml = renderWorkflow();
    const allow = yaml.slice(yaml.indexOf('--allowedTools'));
    expect(allow).not.toMatch(/Bash\(git/);
    expect(allow).not.toMatch(/Bash\(curl/);
    expect(allow).not.toMatch(/WebFetch/);
  });

  it('uses the repo own package manager', () => {
    expect(renderWorkflow({ installCommand: 'pnpm install --frozen-lockfile' })).toContain(
      'Bash(pnpm:*)',
    );
  });

  // The reviewer opening this PR is the audience the whole loop is for. Pasting
  // the agent's JSON input there buried the case for the change.
  it('puts the rendered report in the PR body, not the raw JSON', () => {
    const yaml = renderWorkflow();
    expect(yaml).toContain('body-path: lurq-report.md');
    expect(yaml).not.toContain('body-path: lurq-brief.json');
  });

  // The agent has no network tool, so the only install command it is permitted
  // to run is the one the allowlist names. Telling it to run a different one
  // would fail the step that puts the target version on disk.
  it('tells the agent to reinstall with the manager it is allowed to run', () => {
    const yaml = renderWorkflow({ installCommand: 'pnpm install --frozen-lockfile' });
    expect(yaml).toContain('`pnpm install`');
    expect(yaml).toContain('Bash(pnpm:*)');
  });

  it('points the agent at the brief for replacements rather than at docs', () => {
    const yaml = renderWorkflow();
    expect(yaml).toContain('newExports');
    // It cannot reach documentation, so instructing it to consult any is an
    // instruction to either invent an API or stall.
    expect(yaml).not.toMatch(/consult the package's own docs/);
  });

  it('gates every mutating step on pr mode', () => {
    const yaml = renderWorkflow();
    for (const step of ['Install dependencies', 'Apply upgrades', 'Open pull request']) {
      const at = yaml.indexOf(step);
      expect(at).toBeGreaterThan(-1);
      expect(yaml.slice(at, at + 200)).toContain("env.LURQ_MODE == 'pr'");
    }
  });

  it('accepts either an API key or a subscription OAuth token', () => {
    // Requiring an API key specifically is real onboarding friction; plenty of
    // developers already hold a Claude Pro/Max token.
    const apply = renderWorkflow().split('Apply upgrades')[1] ?? '';
    expect(apply).toContain('anthropic_api_key:');
    expect(apply).toContain('claude_code_oauth_token:');
  });

  it('needs no Anthropic credential to produce the brief', () => {
    // Everything before the credential check is plain CLI, so analyse-only mode
    // works with a lurq key alone. The panel copy makes the same promise.
    const yaml = renderWorkflow();
    const beforeAgent = yaml.slice(0, yaml.indexOf('Check agent credentials'));
    expect(beforeAgent).toContain('upgrade-plan');
    expect(beforeAgent).toContain('check-upgrade');
    expect(beforeAgent).not.toContain('ANTHROPIC_API_KEY');
    expect(beforeAgent).not.toContain('CLAUDE_CODE_OAUTH_TOKEN');
  });

  it('fails pr mode with a readable error when neither credential is set', () => {
    const yaml = renderWorkflow();
    const at = yaml.indexOf('Check agent credentials');
    expect(at).toBeGreaterThan(-1);
    const step = yaml.slice(at, yaml.indexOf('Install dependencies'));
    expect(step).toContain("env.LURQ_MODE == 'pr'");
    expect(step).toContain('::error::');
    expect(step).toContain('exit 1');
  });

  it('writes to a lurq branch, never the default one', () => {
    expect(renderWorkflow()).toContain('branch: lurq/upgrades');
  });

  it('installs at the conventional workflow path', () => {
    expect(WORKFLOW_PATH).toBe('.github/workflows/lurq-upgrade.yml');
  });
});

describe('cli helpers', () => {
  it('parses pkg@from..to, including scoped names', () => {
    expect(parseUpgradeSpec('@types/node@25.6.0..26.1.1')).toEqual({
      package: '@types/node',
      fromVersion: '25.6.0',
      toVersion: '26.1.1',
    });
  });

  it('rejects a malformed spec rather than guessing', () => {
    expect(() => parseUpgradeSpec('commander@12')).toThrow();
  });

  it('merges workspace manifests, first declaration winning', () => {
    expect(
      mergedDeps([
        { path: 'package.json', deps: { react: '^19.0.0' } },
        { path: 'packages/api/package.json', deps: { react: '^18.0.0', zod: '^3.0.0' } },
      ]),
    ).toEqual({ react: '^19.0.0', zod: '^3.0.0' });
  });
});
