import { describe, it, expect } from 'vitest';
import { inFlight, resolveSet } from '../src/pipeline/resolveCheck';

describe('resolveSet concurrency gate', () => {
  it('never runs more than the limit at once, and drains the queue', async () => {
    // npm is not on PATH in CI for this test's purposes; every call rejects.
    // That is fine — what is under test is that the gate accounts slots
    // correctly on the failure path too, since `release()` runs in a `finally`.
    let peak = 0;
    const runs = Array.from({ length: 12 }, () =>
      resolveSet([{ name: 'lurq-nonexistent-xyz', version: '1.0.0' }], {
        concurrency: 3,
        timeoutMs: 1,
        cacheDir: undefined,
      })
        .catch(() => null)
        .finally(() => {
          peak = Math.max(peak, inFlight().active);
        }),
    );
    // Sample while they are in flight.
    await new Promise((r) => setTimeout(r, 5));
    expect(inFlight().active).toBeLessThanOrEqual(3);
    await Promise.all(runs);
    // Every slot handed back: nothing leaked, so the next caller is not blocked.
    expect(inFlight()).toEqual({ active: 0, queued: 0 });
  }, 30_000);
});
