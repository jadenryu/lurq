import { describe, it, expect } from 'vitest';
import { aggregateMissRate } from '../../src/benchmark/missRate';
import type { CaseResult } from '../../src/benchmark/missRate';

function caseResult(over: Partial<CaseResult> = {}): CaseResult {
  return {
    id: 'c',
    package: 'zod',
    version: '3.23.8',
    model: 'm',
    referenced: ['parse'],
    missing: [],
    missRate: 0,
    ...over,
  } as CaseResult;
}

describe('aggregateMissRate', () => {
  // The bug this guards: a case whose generated code referenced no symbols
  // divided 0/0 to NaN, and `NaN !== null` is true — so it passed the
  // "verifiable" filter, counted as scored, and (having no missing symbols)
  // counted as clean. Every headline number moved the same way: optimistic.
  it('treats a case with no referenced symbols as unverifiable, not clean', () => {
    const r = aggregateMissRate(
      [
        caseResult({ id: 'ok', referenced: ['a', 'b'], missing: ['a'], missRate: 0.5 }),
        caseResult({ id: 'empty', referenced: [], missing: [], missRate: null }),
      ],
      'm',
      1,
    );
    expect(r.cases).toBe(2);
    expect(r.scored).toBe(1);
    expect(r.unverifiable).toBe(1);
    // Had the empty case counted as scored-and-clean, this would be 0.5.
    expect(r.caseMissRate).toBe(1);
    expect(r.symbolsPerCase).toBe(2);
  });

  it('excludes NaN even if one reaches the aggregate', () => {
    // Belt-and-braces: the division is guarded upstream, but the filter must
    // not depend on that being true forever.
    const r = aggregateMissRate(
      [
        caseResult({ id: 'ok', referenced: ['a'], missing: ['a'], missRate: 1 }),
        caseResult({ id: 'nan', referenced: [], missing: [], missRate: NaN }),
      ],
      'm',
      1,
    );
    expect(r.scored).toBe(1);
    expect(r.unverifiable).toBe(1);
    expect(r.caseMissRate).toBe(1);
  });

  it('reports nulls rather than NaN when nothing is verifiable', () => {
    const r = aggregateMissRate([caseResult({ referenced: [], missing: [], missRate: null })], 'm', 1);
    expect(r.scored).toBe(0);
    expect(r.caseMissRate).toBeNull();
    expect(r.symbolsPerCase).toBeNull();
    expect(r.symbolMissRate).toBeNull();
    expect(r.projectedBreakRate).toBeNull();
  });
});
