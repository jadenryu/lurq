import { describe, expect, it } from 'vitest';
import { toPublicSummary } from '../src/mcp/publicPackages';

type Row = Parameters<typeof toPublicSummary>[0];

const row = (over: Record<string, unknown> = {}): Row =>
  ({
    name: 'left-pad',
    ecosystem: 'npm',
    description: 'String left pad',
    summary: null,
    latestVersion: '1.3.0',
    license: 'WTFPL',
    category: 'utility',
    repoUrl: null,
    homepage: null,
    healthScore: 41,
    qualityScore: 60,
    confidence: 'proven',
    weeklyDownloads: 2_000_000,
    stars: 1_000,
    lastReleaseAt: new Date('2018-01-01T00:00:00Z'),
    deprecated: true,
    archived: false,
    advisories: [
      { id: 'A1', severity: 'high', summary: 'x' },
      { id: 'A2', severity: 'low', summary: 'y' },
    ],
    scoreBreakdown: { secret: 1 },
    usageGuide: { secret: 1 },
    dataAsOf: new Date('2026-09-01T00:00:00Z'),
    ...over,
  }) as unknown as Row;

describe('toPublicSummary', () => {
  it('never exposes the score breakdown or usage guide', () => {
    // The page is a summary on purpose; the breakdown is what the API sells.
    const s = toPublicSummary(row(), []) as unknown as Record<string, unknown>;
    expect(s.scoreBreakdown).toBeUndefined();
    expect(s.usageGuide).toBeUndefined();
    expect(s.qualityScore).toBeUndefined();
  });

  it('counts severe advisories and keeps unchecked distinct from none', () => {
    expect(toPublicSummary(row(), []).advisories).toEqual({ total: 2, severe: 1 });
    expect(toPublicSummary(row({ advisories: null }), []).advisories).toBeNull();
    expect(toPublicSummary(row({ advisories: [] }), []).advisories).toEqual({ total: 0, severe: 0 });
  });

  it('caps verdict reasons at three and serialises dates', () => {
    const s = toPublicSummary(row(), []);
    expect(s.verdict.reasons.length).toBeLessThanOrEqual(3);
    expect(typeof s.verdict.level).toBe('string');
    expect(s.lastReleaseAt).toBe('2018-01-01T00:00:00.000Z');
  });

  it('prefers the generated summary over the raw npm description', () => {
    expect(toPublicSummary(row({ summary: 'Pads strings.' }), []).description).toBe('Pads strings.');
  });
});
