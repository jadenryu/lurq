import { describe, it, expect, vi } from 'vitest';
import { withBudget } from '../src/core/concurrency';

/**
 * The bug this guards: a copy of this helper in usage/service.ts never cleared
 * its timer, so `lurq usage` kept Node's event loop open for the rest of the
 * 4s budget after the surface had already been printed. Asserting "returns the
 * value" would have passed on the broken version — the timer has to be counted.
 */
describe('withBudget', () => {
  it('clears the timer when the task wins, so nothing holds the event loop', async () => {
    vi.useFakeTimers();
    try {
      const task = Promise.resolve('done');
      const result = await withBudget(task, 4000);
      expect(result).toBe('done');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves null once the budget expires', async () => {
    vi.useFakeTimers();
    try {
      const never = new Promise<string>(() => {});
      const pending = withBudget(never, 4000);
      await vi.advanceTimersByTimeAsync(4000);
      expect(await pending).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves the losing task running — its cache write is the point', async () => {
    vi.useFakeTimers();
    try {
      let settled = false;
      const slow = new Promise<string>((resolve) =>
        setTimeout(() => {
          settled = true;
          resolve('late');
        }, 9000),
      );
      const result = await (async () => {
        const p = withBudget(slow, 4000);
        await vi.advanceTimersByTimeAsync(4000);
        return p;
      })();
      expect(result).toBeNull();
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(5000);
      expect(settled).toBe(true); // still ran to completion after we gave up
    } finally {
      vi.useRealTimers();
    }
  });

  it('propagates a rejection rather than swallowing it into null', async () => {
    await expect(withBudget(Promise.reject(new Error('boom')), 4000)).rejects.toThrow('boom');
  });
});
