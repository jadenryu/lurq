import { describe, expect, it } from 'vitest';
import { trackedPairs } from '../src/pipeline/mineEdges';

const N = (name: string, version = '1.0.0') => ({ name, version });

describe('trackedPairs (§4B bounding)', () => {
  it('only pairs nodes that are both tracked', () => {
    const nodes = [N('react'), N('react-dom'), N('ms'), N('bytes')];
    const tracked = new Set(['react', 'react-dom']);
    const pairs = trackedPairs(nodes, tracked);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ packageA: 'react', packageB: 'react-dom' });
  });

  it('bounds writes to C(tracked-in-tree, 2), not C(N, 2)', () => {
    // 3 tracked among 100 nodes → 3 pairs, not ~5000.
    const plumbing = Array.from({ length: 97 }, (_, i) => N(`plumb-${i}`));
    const nodes = [N('a'), N('b'), N('c'), ...plumbing];
    const pairs = trackedPairs(nodes, new Set(['a', 'b', 'c']));
    expect(pairs).toHaveLength(3);
  });

  it('drops two versions of the same package co-resolving', () => {
    const nodes = [N('react', '17.0.0'), N('react', '18.0.0')];
    expect(trackedPairs(nodes, new Set(['react']))).toHaveLength(0);
  });

  it('canonicalises pair order by name', () => {
    const pairs = trackedPairs([N('zod'), N('axios')], new Set(['zod', 'axios']));
    expect(pairs[0]).toMatchObject({ packageA: 'axios', packageB: 'zod' });
  });
});
