import { describe, it, expect, afterEach } from 'vitest';
import {
  applyOverrides,
  validateWeights,
  loadWeights,
  resetWeightsCache,
  settableKeys,
  DEFAULT_WEIGHTS,
} from '../src/scoring/weights';

afterEach(() => {
  delete process.env.LURQ_COMPOSITE_LAMBDA;
  resetWeightsCache();
});

describe('applyOverrides (§4)', () => {
  it('applies known key=value pairs', () => {
    const next = applyOverrides(DEFAULT_WEIGHTS, ['composite.lambda=0.5', 'health.adoption=0.2']);
    expect(next.composite.lambda).toBe(0.5);
    expect(next.health.adoption).toBe(0.2);
    // does not mutate the input
    expect(DEFAULT_WEIGHTS.composite.lambda).not.toBe(0.5);
  });

  it('rejects unknown keys and malformed entries', () => {
    expect(() => applyOverrides(DEFAULT_WEIGHTS, ['health.bogus=0.5'])).toThrow(/Unknown weight key/);
    expect(() => applyOverrides(DEFAULT_WEIGHTS, ['composite.lambda'])).toThrow(/expected key=value/);
    expect(() => applyOverrides(DEFAULT_WEIGHTS, ['composite.lambda=abc'])).toThrow(/must be a number/);
  });

  it('exposes the settable keys', () => {
    expect(settableKeys()).toContain('composite.lambda');
    expect(settableKeys()).toContain('health.maintenance');
  });
});

describe('validateWeights (§4 sum-to-1 invariant)', () => {
  it('renormalizes health weights that do not sum to 1', () => {
    const { weights, normalized } = validateWeights({
      health: { maintenance: 2, adoption: 2, reliability: 2, efficiency: 2 },
      composite: { lambda: 0.3 },
    });
    expect(normalized).toBe(true);
    const sum =
      weights.health.maintenance +
      weights.health.adoption +
      weights.health.reliability +
      weights.health.efficiency;
    expect(sum).toBeCloseTo(1, 10);
    expect(weights.health.maintenance).toBeCloseTo(0.25, 10);
  });

  it('leaves a valid block untouched', () => {
    const { normalized } = validateWeights(DEFAULT_WEIGHTS);
    expect(normalized).toBe(false);
  });

  it('clamps lambda into [0,1]', () => {
    expect(validateWeights({ ...DEFAULT_WEIGHTS, composite: { lambda: 5 } }).weights.composite.lambda).toBe(1);
    expect(validateWeights({ ...DEFAULT_WEIGHTS, composite: { lambda: -2 } }).weights.composite.lambda).toBe(0);
  });
});

describe('loadWeights env override (§4 defaults ← config ← env)', () => {
  it('honors LURQ_COMPOSITE_LAMBDA over the default', () => {
    process.env.LURQ_COMPOSITE_LAMBDA = '0.8';
    resetWeightsCache();
    expect(loadWeights().composite.lambda).toBe(0.8);
  });
});
