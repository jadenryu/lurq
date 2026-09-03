import { describe, it, expect } from 'vitest';
import { costOf, reserveFor } from '../src/core/modelPricing';

/**
 * The arithmetic a spend cap rests on. Two of these guard against a budget that
 * looks enforced and is not.
 */
describe('costOf', () => {
  it('prices input and output at their separate rates', () => {
    // 1M input at $5 + 1M output at $25 on Opus 5.
    expect(costOf('claude-opus-5', { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(30, 6);
  });

  it('bills a cached read at a tenth of the input rate', () => {
    // The whole reason for caching. Counting cache reads as plain input would
    // overstate a cached conversation ~10x and make the caching look inert.
    const cached = costOf('claude-opus-5', { cache_read_input_tokens: 1_000_000 });
    const plain = costOf('claude-opus-5', { input_tokens: 1_000_000 });
    expect(cached).toBeCloseTo(plain / 10, 6);
  });

  it('bills a cache write at a premium over plain input', () => {
    const written = costOf('claude-opus-5', { cache_creation_input_tokens: 1_000_000 });
    const plain = costOf('claude-opus-5', { input_tokens: 1_000_000 });
    expect(written).toBeGreaterThan(plain);
  });

  it('prices an unknown model as the dearest, never as free', () => {
    // A model id nobody added to the table must not be able to spend without
    // bound because a lookup missed.
    const unknown = costOf('claude-something-unreleased', { input_tokens: 1_000_000 });
    const dearest = costOf('claude-fable-5', { input_tokens: 1_000_000 });
    expect(unknown).toBe(dearest);
    expect(unknown).toBeGreaterThan(0);
  });

  it('treats absent usage fields as zero rather than NaN', () => {
    // A NaN cost compares false against every ceiling, which silently disables
    // the cap instead of tripping it.
    const c = costOf('claude-opus-5', {});
    expect(Number.isFinite(c)).toBe(true);
    expect(c).toBe(0);
  });
});

describe('reserveFor', () => {
  it('exceeds a realistic single turn, so reserving cannot undershoot', () => {
    const reserve = reserveFor('claude-opus-5', 2048);
    const realistic = costOf('claude-opus-5', { input_tokens: 20_000, output_tokens: 2048 });
    expect(reserve).toBeGreaterThan(realistic);
  });
});
