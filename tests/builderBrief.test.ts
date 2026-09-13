import { describe, expect, it } from 'vitest';
import { cardStats, rankRepos, repoBrief, reportBrief, summarize } from '../apps/web/src/lib/builder-brief';
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
