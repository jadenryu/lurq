import { describe, expect, it } from 'vitest';
import {
  cardProfile,
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
    expect(text).toContain('| lodash | 4.17.10 | 4.17.10 | 4.17.21 | 1 advisory |');
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
    const card = cardStats(report)!;
    expect(card).toMatchObject({ overall: 73, position: 'SHP', tier: 'silver' });
    expect(card.stats.find((s) => s.label === 'STR')?.value).toBe('1.2k');
  });

  it('is locked when traits are', () => {
    expect(cardStats({ ...report, traits: null })).toBeNull();
  });
});

describe('cardProfile', () => {
  it('totals the stacks, ranks packages, and flags what needs fixing', () => {
    const d = cardProfile(report)!;
    expect(d.traits.map((t) => [t.label, t.score])).toEqual([['SHP', 90], ['LON', 20], ['RNG', 50], ['HLT', 70]]);
    expect(d.stack.find((s) => s.label === 'deps tracked')?.value).toBe('30');
    expect(d.stack.find((s) => s.label === 'advisories')).toMatchObject({ value: '1', alert: true });
    expect(d.stack.find((s) => s.label === 'majors behind')).toMatchObject({ value: '2', alert: true });
    expect(d.languages).toEqual([{ name: 'TypeScript', share: 1 }]);
    expect(d.packages).toEqual(['lodash', 'react']);
  });

  it('gives one login one id and strip whatever the case, and another login different ones', () => {
    const a = cardProfile(report)!;
    const b = cardProfile({ ...report, login: 'ADA' })!;
    const c = cardProfile({ ...report, login: 'grace' })!;
    expect(b.id).toBe(a.id);
    expect(b.signal).toEqual(a.signal);
    expect(c.id).not.toBe(a.id);
    expect(a.signal.every((v) => v >= 0.2 && v <= 1)).toBe(true);
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
