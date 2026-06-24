import { describe, it, expect } from 'vitest';
import { selectCandidates, passesGate } from '../src/pipeline/discovery';
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
