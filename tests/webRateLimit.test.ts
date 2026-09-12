/**
 * The web app's fixed-window limiter and the headers it hands back (apps/web).
 *
 * The headers are the point: an agent that gets a 429 with no Retry-After
 * retries on its own schedule, which for the Ask route means retrying into the
 * same wall for the rest of the day. The window arithmetic is what makes those
 * headers true, so both are checked here.
 */
import { describe, expect, it } from 'vitest';

import { checkRateLimit, rateLimitHeaders } from '../apps/web/src/lib/rate-limit';

// Unique per test: the limiter's buckets are module-level and shared.
let n = 0;
const key = () => `test:${n++}:${Math.random()}`;

describe('checkRateLimit', () => {
  it('spends the budget, then blocks', () => {
    const k = key();
    expect(checkRateLimit(k, 3).remaining).toBe(2);
    expect(checkRateLimit(k, 3).remaining).toBe(1);

    const last = checkRateLimit(k, 3);
    expect(last.ok).toBe(true);
    expect(last.remaining).toBe(0);

    const blocked = checkRateLimit(k, 3);
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('rolls the window over once it expires', () => {
    const k = key();
    expect(checkRateLimit(k, 1, 1).ok).toBe(true);
    expect(checkRateLimit(k, 1, 1).ok).toBe(false);

    // A window of 1ms is already gone by the time the next call lands, but
    // don't race it: burn real time rather than trusting the scheduler.
    const until = Date.now() + 5;
    while (Date.now() < until) { /* spin */ }

    expect(checkRateLimit(k, 1, 1).ok).toBe(true);
  });

  it('reports a reset in the future and a retry of at least a second', () => {
    const r = checkRateLimit(key(), 5, 60_000);
    expect(r.reset).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(r.retryAfter).toBeGreaterThanOrEqual(1);
    expect(r.retryAfter).toBeLessThanOrEqual(60);
  });
});

describe('rateLimitHeaders', () => {
  it('omits Retry-After while the caller still has budget', () => {
    const h = rateLimitHeaders(checkRateLimit(key(), 5));
    expect(h['Retry-After']).toBeUndefined();
    expect(h['RateLimit-Limit']).toBe('5');
    expect(h['X-RateLimit-Remaining']).toBe('4');
  });

  it('sets Retry-After on a rejection', () => {
    const k = key();
    checkRateLimit(k, 1);
    const h = rateLimitHeaders(checkRateLimit(k, 1));
    expect(Number(h['Retry-After'])).toBeGreaterThanOrEqual(1);
    expect(h['RateLimit-Remaining']).toBe('0');
  });
});
