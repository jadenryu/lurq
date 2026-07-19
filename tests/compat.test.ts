import { describe, it, expect } from 'vitest';
import { canonicalPair, compatSetKey } from '../src/db/compat';
import { deriveCompatEdges, fullyCovered, pairKey } from '../src/pipeline/compat';
import type { SandboxSetResult } from '../src/sandbox/types';

describe('backfill gate (§4C)', () => {
  it('skips a batch only when every pair is already covered', () => {
    const covered = new Set([pairKey('a', 'b'), pairKey('a', 'c'), pairKey('b', 'c')]);
    expect(fullyCovered(['a', 'b', 'c'], covered)).toBe(true);
    // Missing b|c → not covered → must run.
    covered.delete(pairKey('b', 'c'));
    expect(fullyCovered(['a', 'b', 'c'], covered)).toBe(false);
  });
});

describe('compatSetKey (self-heal dedup)', () => {
  it('is order-independent and dedups names, so one set enqueues once', () => {
    expect(compatSetKey(['react', 'lodash'])).toBe(compatSetKey(['lodash', 'react']));
    expect(compatSetKey(['a', 'b', 'a'])).toBe('a|b');
  });
});

function result(over: Partial<SandboxSetResult>): SandboxSetResult {
  return {
    driver: 'local',
    moduleSystem: 'cjs',
    installed: true,
    loaded: [],
    durationMs: 1,
    error: null,
    ...over,
  };
}

describe('canonicalPair', () => {
  it('orders by package name regardless of input order', () => {
    const a = canonicalPair({ name: 'react', version: '19' }, { name: 'axios', version: '1' });
    const b = canonicalPair({ name: 'axios', version: '1' }, { name: 'react', version: '19' });
    expect(a).toEqual(b);
    expect(a.packageA).toBe('axios');
    expect(a.packageB).toBe('react');
  });
});

describe('deriveCompatEdges', () => {
  const resolved = [
    { name: 'react', version: '19.0.0' },
    { name: 'react-dom', version: '19.0.0' },
    { name: 'zod', version: '3.0.0' },
  ];
  const allLoaded = (rs: typeof resolved) => rs.map((r) => ({ name: r.name, loaded: true }));
  const noneLoaded = (rs: typeof resolved) =>
    rs.map((r) => ({ name: r.name, loaded: null as boolean | null }));

  it('marks every pair compatible when the set co-installs and all load', () => {
    const edges = deriveCompatEdges(
      resolved,
      result({ installed: true, loaded: allLoaded(resolved) }),
    );
    expect(edges).toHaveLength(3); // 3 choose 2
    expect(edges.every((e) => e.status === 'compatible')).toBe(true);
  });

  it('marks a failed PAIR as a conflict (precise attribution)', () => {
    const pair = resolved.slice(0, 2);
    const edges = deriveCompatEdges(
      pair,
      result({ installed: false, loaded: noneLoaded(pair) }),
    );
    expect(edges).toEqual([
      expect.objectContaining({ a: 'react', b: 'react-dom', status: 'conflict' }),
    ]);
  });

  it('asserts no edge for a larger failed set (cannot attribute the conflict)', () => {
    const edges = deriveCompatEdges(
      resolved,
      result({ installed: false, loaded: noneLoaded(resolved) }),
    );
    expect(edges).toEqual([]);
  });

  it('does not assert compatibility when a member fails to load', () => {
    const edges = deriveCompatEdges(
      resolved,
      result({
        installed: true,
        loaded: [
          { name: 'react', loaded: true },
          { name: 'react-dom', loaded: true },
          { name: 'zod', loaded: false },
        ],
      }),
    );
    expect(edges).toEqual([]);
  });
});
