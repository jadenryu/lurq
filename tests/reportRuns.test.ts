import { describe, it, expect } from 'vitest';
import { buildRunReports, runContextFromEnv } from '../src/cli/reportRuns';
import { parseUpgradeRun } from '../src/github/runs';
import type { UpgradeReport, UpgradeTarget } from '../src/surface/upgrade';

/**
 * POST /upgrade-runs shipped with validation, an upsert and an impact query
 * behind it — and no client at all, so every real account's dashboard showed
 * "No autopilot runs yet" and an impact row of zeroes forever. These cover the
 * mapping that closes that loop, including the round-trip through the server's
 * own validator so the two halves cannot drift apart.
 */
const ctx = { repoFullName: 'acme/app', runUrl: 'https://github.com/acme/app/actions/runs/42' };

const targets: UpgradeTarget[] = [
  { package: 'react-router', fromVersion: '6.0.0', toVersion: '8.0.0' },
  { package: 'zod', fromVersion: '3.22.4', toVersion: '3.23.8' },
  { package: 'chalk', fromVersion: '4.0.0', toVersion: '5.0.0' },
];

const ref = (file: string, line: number) => ({
  symbol: 'useHistory',
  via: 'named' as never,
  specifier: 'react-router',
  file,
  line,
});

const report: UpgradeReport = {
  safe: false,
  breaking: [
    {
      package: 'react-router',
      fromVersion: '6.0.0',
      toVersion: '8.0.0',
      severity: 'blocking',
      symbolsRemoved: [
        { symbol: 'useHistory', refs: [ref('src/a.ts', 3), ref('src/b.ts', 9), ref('src/a.ts', 40)] },
      ],
      arityChanged: [
        { symbol: 'matchPath', from: 2, to: 1, refs: [ref('src/c.ts', 7)] },
      ],
      newExports: [],
    },
  ],
  ok: ['zod'],
  unverified: [{ package: 'chalk', reason: 'no readable surface' }],
};

describe('buildRunReports', () => {
  it('reports every target exactly once, in the right severity', () => {
    const rows = buildRunReports(report, targets, ctx);
    expect(rows).toHaveLength(3);
    expect(Object.fromEntries(rows.map((r) => [r.packageName, r.severity]))).toEqual({
      'react-router': 'blocking',
      zod: 'ok',
      chalk: 'unverified',
    });
  });

  it('counts call sites across removals AND arity changes, and dedupes files', () => {
    const row = buildRunReports(report, targets, ctx).find((r) => r.packageName === 'react-router')!;
    expect(row.callSites).toBe(4); // 3 removal refs + 1 arity ref
    expect(row.symbolsAffected).toEqual(['useHistory', 'matchPath']);
    // src/a.ts appears twice in the refs; the file list is a set.
    expect(row.callSiteFiles).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('keeps unverified visible — a dashboard of only what we checked reads as all-clear', () => {
    const rows = buildRunReports(report, targets, ctx);
    const chalk = rows.find((r) => r.packageName === 'chalk')!;
    expect(chalk.severity).toBe('unverified');
    expect(chalk.fromVersion).toBe('4.0.0');
    expect(chalk.toVersion).toBe('5.0.0');
  });

  it('drops a package with no known versions rather than posting an unkeyable row', () => {
    const rows = buildRunReports({ ...report, ok: ['zod', 'mystery-pkg'] }, targets, ctx);
    expect(rows.map((r) => r.packageName)).not.toContain('mystery-pkg');
  });

  it('carries the run url, which is the dedup key for a re-run', () => {
    for (const row of buildRunReports(report, targets, ctx)) {
      expect(row.runUrl).toBe(ctx.runUrl);
      expect(row.status).toBe('checked');
    }
  });

  // The two halves of this feature are validated by different code in different
  // processes. If the client's shape ever drifts from the server's parser, the
  // symptom is a silently empty dashboard — the exact bug being fixed.
  it('produces rows the server validator accepts unchanged', () => {
    for (const row of buildRunReports(report, targets, ctx)) {
      expect(parseUpgradeRun(row)).not.toBeNull();
    }
  });
});

describe('runContextFromEnv', () => {
  it('builds the Actions run permalink', () => {
    expect(
      runContextFromEnv({
        GITHUB_REPOSITORY: 'acme/app',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_RUN_ID: '42',
      } as NodeJS.ProcessEnv),
    ).toEqual(ctx);
  });

  it('returns null off a runner — there is no run to attribute rows to', () => {
    expect(runContextFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it('leaves runUrl empty rather than inventing one without a run id', () => {
    const got = runContextFromEnv({ GITHUB_REPOSITORY: 'acme/app' } as NodeJS.ProcessEnv);
    // A fabricated URL would differ per job and multiply every dashboard total.
    expect(got).toEqual({ repoFullName: 'acme/app', runUrl: '' });
  });

  it('honours a GitHub Enterprise server url', () => {
    const got = runContextFromEnv({
      GITHUB_REPOSITORY: 'acme/app',
      GITHUB_SERVER_URL: 'https://ghe.acme.com',
      GITHUB_RUN_ID: '7',
    } as NodeJS.ProcessEnv);
    expect(got!.runUrl).toBe('https://ghe.acme.com/acme/app/actions/runs/7');
  });
});
