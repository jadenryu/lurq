import { describe, expect, it } from 'vitest';
import {
  archetypeLine,
  cardProfile,
  depLabel,
  mcpServerLabel,
  mcpToolPower,
  mcpToolSummary,
  depStatus,
  savedDaysAgo,
  cardStats,
  conflictBrief,
  depBrief,
  namesPackage,
  packageImpact,
  rankRepos,
  repoBrief,
  reportBrief,
  sharedPackages,
  summarize,
} from '../apps/web/src/lib/builder-brief';
import type { BuilderReport, RepoStack } from '../apps/web/src/lib/builder-profile';

/**
 * Pinned: the brief never claims an all-clear it did not check, the worst repo
 * comes first by evidence, a signed-out report yields no summary or card, and
 * the card's overall is position-weighted.
 */

function stack(repo: string, over: Partial<RepoStack> = {}): RepoStack {
  return {
    repo,
    url: `https://github.com/${repo}`,
    depsDeclared: 10,
    depsTracked: 10,
    majorDrift: 0,
    anyDrift: 0,
    deprecated: 0,
    advisories: 0,
    conflicts: 0,
    deps: [],
    conflictDetail: [],
    partial: false,
    ...over,
  };
}

const clean = stack('ada/clean');
const drifted = stack('ada/drifted', {
  majorDrift: 2,
  deps: [{ name: 'react', range: '^17.0.0', resolved: '17.0.2', latest: '19.1.0', majorsBehind: 2, deprecated: false, advisories: 0 }],
});
const vulnerable = stack('ada/vulnerable', {
  depsDeclared: 12,
  advisories: 1,
  conflicts: 1,
  deps: [{ name: 'lodash', range: '4.17.10', resolved: '4.17.10', latest: '4.17.21', majorsBehind: 0, deprecated: false, advisories: 1 }],
  conflictDetail: [{ source: 'peer-deps', packages: ['eslint', 'eslint-plugin-x'], detail: 'peer eslint@^8' }],
});

const report: BuilderReport = {
  login: 'ada',
  url: 'https://github.com/ada',
  avatarUrl: 'https://github.com/ada.png',
  archetype: 'shipper',
  traits: [
    { id: 'shipper', score: 90, evidence: ['9 repos pushed in the last 90 days'] },
    { id: 'architect', score: 20, evidence: ['0 repos kept alive for 2+ years'] },
    { id: 'explorer', score: 50, evidence: ['3 languages across 12 repos'] },
    { id: 'steward', score: 70, evidence: ['30 dependencies read'] },
  ],
  stats: { repos: 12, active90: 9, stars: 1234, languages: [{ name: 'TypeScript', repos: 8 }] },
  repos: [clean, drifted, vulnerable],
  locked: null,
};

describe('rankRepos', () => {
  it('orders by advisories, then conflicts, then drift, keeping ties stable', () => {
    expect(rankRepos(report.repos).map((s) => s.repo)).toEqual(['ada/vulnerable', 'ada/drifted', 'ada/clean']);
  });
});

describe('summarize', () => {
  it('names strengths and gaps from traits and stacks', () => {
    const s = summarize(report)!;
    expect(s.strengths.map((p) => p.title)).toEqual(['You ship often', 'Your dependencies stay current']);
    expect(s.gaps.map((p) => p.title)).toContain('Few long-lived projects');
    expect(s.gaps.find((p) => p.title.includes('advisory'))?.detail).toContain('start with ada/vulnerable');
  });

  it('is locked when traits are', () => {
    expect(summarize({ ...report, traits: null })).toBeNull();
  });

  it('always has a strength, even with low scores', () => {
    const low = report.traits!.map((t) => ({ ...t, score: 10 }));
    expect(summarize({ ...report, traits: low, repos: [vulnerable] })!.strengths).toHaveLength(1);
  });
});

describe('briefs', () => {
  it('puts the worst repo first and names what was not checked', () => {
    const text = reportBrief(report);
    expect(text.indexOf('## ada/vulnerable')).toBeLessThan(text.indexOf('## ada/clean'));
    // The fixture's advisory was never checked at 4.17.10, so the brief says which release it is known for.
    expect(text).toContain('| lodash | 4.17.10 | 4.17.10 | 4.17.21 | 1 advisory on the latest release |');
    expect(text).toContain('[peer-deps] eslint + eslint-plugin-x');
    expect(text).toContain('2 not indexed yet, so unchecked (not clean)');
  });

  it('says what a signed-out export left out', () => {
    const text = reportBrief({ ...report, traits: null, repos: [vulnerable], locked: { repos: 2, deps: 5, conflicts: 1 } });
    expect(text).not.toContain('## Summary');
    expect(text).toContain('2 more repos read but not in this export');
    expect(text).toContain('5 more dependencies not included');
  });

  it('never calls an unindexed repo clean', () => {
    const text = repoBrief(stack('ada/new', { depsTracked: 0 }));
    expect(text).toContain('no all-clear');
    expect(text).not.toContain('No advisories');
  });
});

describe('cardStats', () => {
  it('weights the archetype trait and picks a tier', () => {
    // 0.6 * 90 + 0.4 * mean(20, 50, 70)=46.67 → 72.7 → 73, silver.
    expect(cardStats(report)).toEqual({ overall: 73, position: 'SHP', tier: 'silver' });
  });

  it('leaves an unmeasured trait out of the mean instead of counting it as zero', () => {
    const traits = report.traits!.map((t) => (t.id === 'steward' ? { ...t, score: null } : t));
    // 0.6 * 90 + 0.4 * mean(20, 50)=35 → 68.
    expect(cardStats({ ...report, traits })!.overall).toBe(68);
  });

  it('never rates above the top trait', () => {
    const card = cardStats(report)!;
    expect(card.overall).toBeLessThanOrEqual(90);
  });

  it('is locked when traits are', () => {
    expect(cardStats({ ...report, traits: null })).toBeNull();
  });
});

describe('cardProfile', () => {
  it('labels each trait with the code its archetype uses', () => {
    const d = cardProfile(report)!;
    expect(d.traits.map((t) => [t.code, t.score])).toEqual([['SHP', 90], ['ARC', 20], ['EXP', 50], ['STW', 70]]);
  });

  it('reads languages as a share of owned repos, not of the languages listed', () => {
    const d = cardProfile({ ...report, stats: { ...report.stats, repos: 12, languages: [{ name: 'TypeScript', repos: 8 }, { name: 'Go', repos: 2 }] } })!;
    expect(d.languages).toEqual([{ name: 'TypeScript', share: 8 / 12 }, { name: 'Go', share: 2 / 12 }]);
    expect(d.github).toEqual([
      { label: 'repos', value: '12' },
      { label: 'active 90d', value: '9' },
      { label: 'stars', value: '1.2k' },
    ]);
  });

  it('splits tracked dependencies into disjoint current / behind / a-major-behind counts', () => {
    const d = cardProfile({
      ...report,
      repos: [
        stack('ada/a', { depsTracked: 40, anyDrift: 12, majorDrift: 5, deprecated: 1, advisories: 2 }),
        stack('ada/b', { depsTracked: 10, anyDrift: 3, majorDrift: 0, conflicts: 1 }),
      ],
    })!;
    expect(d.freshness).toEqual({ current: 35, behind: 10, major: 5 });
    const { current, behind, major } = d.freshness!;
    expect(current + behind + major).toBe(50);
    expect(d.stack).toEqual([
      { label: 'deps tracked', value: '50', alert: false },
      { label: 'a major behind', value: '5', alert: true },
      { label: 'deprecated', value: '1', alert: true },
      { label: 'advisories', value: '2', alert: true },
      { label: 'conflicts at latest', value: '1', alert: true },
    ]);
    expect(d.stacks).toBe(2);
  });

  it('never draws a negative segment when counts disagree, and calls nothing tracked unmeasured', () => {
    // The shared fixture has a major-drift count with no any-drift count.
    expect(cardProfile(report)!.freshness).toEqual({ current: 28, behind: 0, major: 2 });
    expect(cardProfile({ ...report, repos: [] })!.freshness).toBeNull();
  });

  it('ranks packages by how many repos declare them', () => {
    const dep = (name: string) => ({ name, range: '^1', resolved: '1.0.0', latest: '1.0.0', majorsBehind: 0, deprecated: false, advisories: 0 });
    const d = cardProfile({
      ...report,
      repos: [stack('ada/a', { deps: [dep('zod'), dep('react')] }), stack('ada/b', { deps: [dep('react')] })],
    })!;
    expect(d.packages).toEqual(['react', 'zod']);
  });

  it('gives one login one id whatever the case', () => {
    expect(cardProfile({ ...report, login: 'ADA' })!.id).toBe(cardProfile(report)!.id);
    expect(cardProfile({ ...report, login: 'grace' })!.id).not.toBe(cardProfile(report)!.id);
  });

  it('is locked when traits are', () => {
    expect(cardProfile({ ...report, traits: null })).toBeNull();
  });
});

describe('drill-down', () => {
  const app = stack('ada/app', {
    majorDrift: 1,
    conflicts: 1,
    deps: [{ name: 'react', range: '^18.0.0', resolved: '18.3.1', latest: '19.1.0', majorsBehind: 1, deprecated: false, advisories: 0 }],
    conflictDetail: [{ source: 'peer-deps', packages: ['react@19.1.0', 'react-dom'], detail: 'react-dom wants react@^18' }],
  });
  const profile: BuilderReport = { ...report, repos: [app, drifted, clean] };

  it('finds every repo declaring a package and the conflicts that name it', () => {
    const impact = packageImpact(profile, 'react');
    expect(impact.uses.map((u) => u.repo)).toEqual(['ada/app', 'ada/drifted']);
    expect(impact.conflicts).toHaveLength(1);
    expect(namesPackage('react@19.1.0', 'react')).toBe(true);
    expect(namesPackage('react-dom', 'react')).toBe(false);
  });

  it('lists packages shared across repos with their version spread', () => {
    expect(sharedPackages(profile)).toEqual([
      expect.objectContaining({ name: 'react', versions: ['18.3.1', '17.0.2'], flagged: true }),
    ]);
  });

  const diff = {
    fromVersion: '18.3.1',
    toVersion: '19.1.0',
    verdict: 'verified_true',
    removed: [{ path: 'render', kind: 'function' }],
    renamed: [{ path: 'render', to: ['createRoot'] }],
    arityChanged: [],
    typeOnlyRemoved: [],
    deprecated: [],
  };
  const detail = { diff, advisories: null, deprecated: false, reasons: [], unavailable: [] };

  it('puts what changed into the package brief, with proven renames', () => {
    const text = depBrief(profile, 'react', detail);
    expect(text).toContain('| ada/drifted | ^17.0.0 | 17.0.2 | 19.1.0 | 2 majors behind |');
    expect(text).toContain('- `render` → now `createRoot`');
    expect(text).toContain('react-dom wants react@^18');
  });

  it('never reads an uncompared diff, or a missing one, as nothing changed', () => {
    const pending = depBrief(profile, 'react', { ...detail, diff: { ...diff, verdict: 'unknown', inconclusive: 'queued', removed: [], renamed: [] } });
    expect(pending).toContain('Not compared yet');
    expect(pending).not.toContain('No runtime exports');
    expect(depBrief(profile, 'react')).toContain('is not included here');
  });

  it("writes a conflict brief with this repo's versions of each package", () => {
    const text = conflictBrief(profile, 'ada/app', app.conflictDetail[0]!);
    expect(text).toContain('| react | ^18.0.0 | 18.3.1 | 19.1.0 |');
    expect(text).toContain('| react-dom | not declared at the root | ? | ? |');
  });

  it('tells the agent to check its work with lurq, and where to scan again', () => {
    const text = repoBrief(drifted);
    expect(text).toContain('`diff_surface`');
    expect(text).toContain('npx lurqrun');
    expect(text).toContain('/dashboard/report?target=ada%2Fdrifted');
  });
});

describe('dependency labels', () => {
  const d = (over: Partial<RepoStack['deps'][number]> = {}) => ({
    name: 'pkg',
    range: '^1.2.0',
    resolved: '1.2.0',
    latest: '1.5.0',
    majorsBehind: 0,
    deprecated: false,
    advisories: 0,
    ...over,
  });

  it('never calls a dependency current when it is behind or unknown', () => {
    expect(depLabel(d({ status: 'behind' }))).toBe('behind latest');
    expect(depLabel(d({ status: 'major', majorsBehind: 0, resolved: '0.3.0', latest: '0.9.0' }))).toBe(
      'breaking 0.x release behind',
    );
    expect(depLabel(d({ status: 'unknown', latest: null }))).toBe('version unknown');
    expect(depLabel(d({ status: 'current', resolved: '1.5.0' }))).toBe('current');
  });

  it('works out a saved scan without a status, and only calls it current when the versions match', () => {
    expect(depStatus(d())).toBe('behind');
    expect(depStatus(d({ latest: null }))).toBe('unknown');
    expect(depStatus(d({ resolved: '1.5.0' }))).toBe('current');
    expect(depStatus(d({ majorsBehind: 2 }))).toBe('major');
  });

  it('says which version advisories are about', () => {
    expect(depLabel(d({ advisories: 1, advisoriesAt: 'resolved' }))).toBe('1 advisory at 1.2.0');
    expect(depLabel(d({ advisories: 2, advisoriesAt: 'package' }))).toBe('2 advisories on the latest release');
    expect(depLabel(d({ advisories: 2 }))).toBe('2 advisories on the latest release');
  });
});

describe('summary accuracy', () => {
  it('titles a deprecated-only gap as deprecated, not as 0 majors behind', () => {
    const s = summarize({ ...report, repos: [stack('ada/old', { deprecated: 2, advisoriesExact: true })] })!;
    expect(s.gaps.map((g) => g.title)).toContain('2 deprecated dependencies');
    expect(s.gaps.some((g) => g.title.startsWith('0 '))).toBe(false);
  });

  it('shows majors behind alongside advisories instead of hiding them', () => {
    const s = summarize({ ...report, repos: [stack('ada/x', { advisories: 1, majorDrift: 3 })] })!;
    expect(s.gaps.map((g) => g.title)).toEqual(expect.arrayContaining(['1 known advisory', '3 dependencies a major behind']));
  });

  it('claims no known advisories only when every repo was checked at its resolved versions', () => {
    const exact = summarize({ ...report, repos: [stack('ada/a', { advisoriesExact: true })] })!;
    const inexact = summarize({ ...report, repos: [stack('ada/a', { advisoriesExact: false })] })!;
    expect(exact.strengths.map((p) => p.title)).toContain('No known advisories or conflicts');
    expect(inexact.strengths.map((p) => p.title)).not.toContain('No known advisories or conflicts');
  });
});

describe('archetypeLine', () => {
  it('describes only when the top trait clears the floor', () => {
    expect(archetypeLine(report)).toMatch(/push them out/);
    const quiet = report.traits!.map((t) => ({ ...t, score: 5 }));
    expect(archetypeLine({ ...report, traits: quiet })).toMatch(/closest fit/);
  });
});

describe('savedDaysAgo', () => {
  it('counts whole days', () => {
    const now = Date.parse('2026-09-14T12:00:00Z');
    expect(savedDaysAgo('2026-09-14T01:00:00Z', now)).toBe(0);
    expect(savedDaysAgo('2026-09-11T12:00:00Z', now)).toBe(3);
  });
});

describe('mcpServerLabel', () => {
  const server = (over: Record<string, unknown> = {}) =>
    ({
      alias: 'x',
      kind: 'npm-stdio',
      packageName: 'x',
      endpoint: null,
      status: 'probed',
      tools: 3,
      writes: 2,
      destroys: 1,
      requiredConfig: [],
      ...over,
    }) as Parameters<typeof mcpServerLabel>[0];

  it('states probed counts and never calls an unprobed server fine', () => {
    expect(mcpServerLabel(server())).toBe('3 tools, 2 can write, 1 destructive');
    expect(mcpServerLabel(server({ status: 'queued' }))).toBe('not probed yet, queued');
    expect(mcpServerLabel(server({ status: 'needs-config', requiredConfig: ['GITHUB_TOKEN'] }))).toBe('needs GITHUB_TOKEN to probe');
    expect(mcpServerLabel(server({ status: 'not-probed', kind: 'remote' }))).toBe('remote endpoint, not probed by lurq');
    expect(mcpServerLabel(server({ status: 'not-probed', kind: 'other-registry' }))).toBe('PyPI or Docker, not probed by lurq');
  });
});

describe('mcp tool schema', () => {
  const t = (over: Record<string, unknown> = {}) =>
    ({ name: 'search', required: ['query'], params: ['query', 'limit'], readOnly: true, destructive: false, output: true, deprecated: false, ...over }) as Parameters<typeof mcpToolSummary>[0];

  it('says what a tool takes and returns', () => {
    expect(mcpToolSummary(t())).toBe('2 params, 1 required · structured output');
    expect(mcpToolSummary(t({ params: [], required: [], output: false }))).toBe('no parameters');
    expect(mcpToolSummary(t({ deprecated: true }))).toContain('deprecated');
  });

  it('treats an unannotated tool as destructive, the way the spec does', () => {
    expect(mcpToolPower(t()).text).toBe('read-only');
    expect(mcpToolPower(t({ readOnly: false })).text).toBe('writes');
    expect(mcpToolPower(t({ readOnly: false, destructive: true })).text).toBe('destructive');
  });
});
