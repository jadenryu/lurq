import { describe, it, expect } from 'vitest';
import { toCandidate, type Row } from '../src/search/recommend';

/**
 * `recommend` is the call an agent makes BEFORE choosing a dependency, and its
 * candidates carried no deprecated / archived / advisory fields at all. A dead
 * package could come back with a respectable-looking score and nothing in the
 * payload saying not to install it.
 */
const row = (over: Partial<Row> = {}): Row => ({
  name: 'request',
  category: 'http-client',
  healthScore: 55,
  qualityScore: 40,
  confidence: 'unproven',
  latestVersion: '2.88.2',
  weeklyDownloads: 12_000_000,
  lastReleaseAt: null,
  repoUrl: null,
  deprecated: false,
  archived: false,
  advisories: 0,
  ...over,
});

describe('recommend candidates carry the disqualifying facts', () => {
  it('emits the three flags even when clean, so absence never has to be read as meaning', () => {
    const c = toCandidate(row());
    // compact() keeps false and 0 on purpose; an agent must not infer from a
    // missing field whether we checked.
    expect(c.deprecated).toBe(false);
    expect(c.archived).toBe(false);
    expect(c.advisories).toBe(0);
  });

  it('leads the rationale with DEPRECATED, not a footnote after the score', () => {
    const c = toCandidate(row({ deprecated: true }));
    expect(c.deprecated).toBe(true);
    expect(c.why.startsWith('DEPRECATED')).toBe(true);
    // The score still follows — the point is ordering, not suppression.
    expect(c.why).toContain('health 55');
  });

  it('reports an archived repo and an advisory count', () => {
    const c = toCandidate(row({ archived: true, advisories: 3 }));
    expect(c.why).toContain('repo archived');
    expect(c.why).toContain('3 advisories');
    expect(c.advisories).toBe(3);
  });

  it('singularises one advisory', () => {
    expect(toCandidate(row({ advisories: 1 })).why).toContain('1 advisory');
  });

  it('leaves a clean package’s rationale exactly as it was', () => {
    expect(toCandidate(row()).why).toBe('unproven, 12M weekly downloads, health 55');
  });

  it('coerces a bigint-ish advisory count from the driver', () => {
    // jsonb_array_length comes back through postgres.js; Number() it rather than
    // letting a string land in a field the dashboard does arithmetic on.
    expect(toCandidate(row({ advisories: '2' as unknown as number })).advisories).toBe(2);
  });
});
