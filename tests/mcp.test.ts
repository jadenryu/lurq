import { describe, it, expect } from 'vitest';
import { rowToEvaluate } from '../src/mcp/handlers';
import type { PackageRow } from '../src/db/schema';
import type { Advisory } from '../src/core/types';

function makeRow(overrides: Partial<PackageRow> = {}): PackageRow {
  const advisories: Advisory[] = [
    { id: 'a1', severity: 'low', summary: 'low' },
    { id: 'a2', severity: 'critical', summary: 'crit' },
    { id: 'a3', severity: 'moderate', summary: 'mod' },
    { id: 'a4', severity: 'high', summary: 'high' },
    { id: 'a5', severity: 'info', summary: 'info' },
    { id: 'a6', severity: 'high', summary: 'high2' },
  ];
  return {
    id: 1,
    name: 'x',
    ecosystem: 'npm',
    category: 'orm',
    description: 'desc',
    summary: 'One sentence. Two sentence. Three sentence. Four sentence.',
    repoUrl: 'https://github.com/x/y',
    homepage: null,
    latestVersion: '1.0.0',
    license: 'MIT',
    deprecated: false,
    archived: false,
    firstPublishedAt: new Date('2020-01-01'),
    lastReleaseAt: new Date('2026-06-01'),
    weeklyDownloads: 1000,
    downloadGrowth90d: 0.1,
    dependentsCount: null,
    stars: null,
    openIssues: null,
    closedIssues: null,
    scorecard: 8,
    bundleMinGzipKb: null,
    advisories,
    healthScore: 80,
    confidence: 'proven',
    scoreBreakdown: { maintenance: 80, adoption: 80, reliability: 80, efficiency: null },
    usageGuide: { whatItIs: 'x', whenToUse: 'y', whereItFits: 'z' },
    embedding: null,
    dataAsOf: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as PackageRow;
}

describe('rowToEvaluate', () => {
  it('truncates the summary to 3 sentences', () => {
    const out = rowToEvaluate(makeRow());
    expect(out.summary).toBe('One sentence. Two sentence. Three sentence.');
  });

  it('caps advisories at 5, ordered by severity', () => {
    const out = rowToEvaluate(makeRow());
    expect(out.advisories).toHaveLength(5);
    expect(out.advisories[0]!.severity).toBe('critical');
    expect(out.advisories.map((a) => a.severity)).not.toContain('info'); // lowest dropped
  });

  it('flags stale data older than the threshold', () => {
    const fresh = rowToEvaluate(makeRow());
    expect(fresh.stale).toBeUndefined();
    const old = rowToEvaluate(makeRow({ dataAsOf: new Date(Date.now() - 30 * 86400000) }));
    expect(old.stale).toBe(true);
  });

  it('serializes dates to ISO strings', () => {
    const out = rowToEvaluate(makeRow());
    expect(out.lastReleaseAt).toBe(new Date('2026-06-01').toISOString());
    expect(typeof out.dataAsOf).toBe('string');
  });
});
