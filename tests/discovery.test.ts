import { describe, it, expect } from 'vitest';
import { selectCandidates, passesGate, nextSearchOffset } from '../src/pipeline/discovery';
import { DISCOVERY } from '../src/scoring/weights';
import type { DiscoveryCandidate } from '../src/db/discovery';

describe('selectCandidates (§2B dedupe + known-filter)', () => {
  const c = (name: string, via: DiscoveryCandidate['via'] = 'category-search'): DiscoveryCandidate => ({
    name,
    via,
  });

  it('drops names already tracked or queued', () => {
    const known = new Set(['zod', 'drizzle-orm']);
    const out = selectCandidates([c('zod'), c('new-pkg'), c('drizzle-orm')], known);
    expect(out.map((x) => x.name)).toEqual(['new-pkg']);
  });

  it('dedupes within the batch, first channel wins', () => {
    const out = selectCandidates(
      [c('pkg', 'dependency-graph'), c('pkg', 'category-search')],
      new Set(),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.via).toBe('dependency-graph');
  });

  it('skips blank/whitespace names', () => {
    const out = selectCandidates([c(''), c('   '), c('real')], new Set());
    expect(out.map((x) => x.name)).toEqual(['real']);
  });
});

describe('passesGate (§2B merit gate — quality only)', () => {
  it('requires the pre-score to clear the bar', () => {
    expect(passesGate(DISCOVERY.minPreScore)).toBe(true);
    expect(passesGate(DISCOVERY.minPreScore + 10)).toBe(true);
    expect(passesGate(DISCOVERY.minPreScore - 1)).toBe(false);
  });

  it('rejects candidates with no pre-score (registry fetch failed)', () => {
    expect(passesGate(null)).toBe(false);
  });
});

describe('nextSearchOffset (§2B search channel walks the ranking)', () => {
  const page = DISCOVERY.searchSizePerCategory;

  it('starts at the head when no cursor is stored', () => {
    expect(nextSearchOffset(null)).toBe(0);
  });

  it('advances one page per run instead of re-reading the head', () => {
    let cursor: string | null = null;
    const walked: number[] = [];
    for (let i = 0; i < 4; i++) {
      const from = nextSearchOffset(cursor);
      walked.push(from);
      cursor = String(from + page);
    }
    expect(walked).toEqual([0, page, page * 2, page * 3]);
    expect(new Set(walked).size).toBe(walked.length);
  });

  it('laps back to the head rather than walking off into unranked noise', () => {
    // Whatever the cursor, the offset stays inside the paged window.
    for (const stored of ['500', '510', '9999']) {
      const from = nextSearchOffset(stored);
      expect(from).toBeGreaterThanOrEqual(0);
      expect(from).toBeLessThan(500);
    }
    expect(nextSearchOffset('500')).toBe(0);
  });

  it('treats a corrupt or negative cursor as the head', () => {
    expect(nextSearchOffset('not-a-number')).toBe(0);
    expect(nextSearchOffset('-40')).toBe(0);
    expect(nextSearchOffset('')).toBe(0);
  });
});
