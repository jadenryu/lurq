/**
 * The public scan's cache rules.
 *
 * Both of these exist because of a specific wrong answer. The TTL split: an
 * unindexed repo queues its dependencies, finishes in seconds, and tells the
 * visitor to try again in a few minutes — which a flat fifteen-minute cache
 * turned into a lie. The eviction: `clear()` at the cap cost every other
 * cached repo its entry, so one unlucky request re-scanned the whole set.
 */
import { describe, expect, it } from 'vitest';

import { evictScans, scanTtl, type ScanCacheEntry } from '../src/mcp/http';
import type { PublicScan } from '../src/github/publicScan';

function scan(depsDeclared: number, depsTracked: number): PublicScan {
  return {
    repo: 'owner/repo',
    url: 'https://github.com/owner/repo',
    depsDeclared,
    depsTracked,
    majorDrift: 0,
    anyDrift: 0,
    deprecated: 0,
    advisories: 0,
    conflicts: 0,
    deps: [],
    partial: true,
  };
}

const FIFTEEN_MIN = 15 * 60_000;

describe('scanTtl', () => {
  it('holds a fully-indexed answer for the long window', () => {
    expect(scanTtl(scan(12, 12))).toBe(FIFTEEN_MIN);
  });

  it('holds a partial answer only briefly — the queue is fixing it', () => {
    expect(scanTtl(scan(12, 3))).toBeLessThan(FIFTEEN_MIN);
  });

  it('treats a repo with nothing indexed as provisional, not settled', () => {
    expect(scanTtl(scan(36, 0))).toBeLessThan(FIFTEEN_MIN);
  });

  it('treats an unreadable target as provisional', () => {
    expect(scanTtl(null)).toBeLessThan(FIFTEEN_MIN);
  });

  it('does not call a repo with no dependencies partial', () => {
    // 0 of 0 tracked is complete, not a miss: a real repo can declare nothing.
    expect(scanTtl(scan(0, 0))).toBe(FIFTEEN_MIN);
  });
});

describe('evictScans', () => {
  const entry = (at: number, ttl = FIFTEEN_MIN): ScanCacheEntry => ({ at, ttl, value: null });

  it('drops what has expired and keeps what has not', () => {
    const now = Date.now();
    const cache = new Map<string, ScanCacheEntry>([
      ['stale', entry(now - 60_000, 45_000)],
      ['fresh', entry(now)],
    ]);

    evictScans(cache, 2);

    expect([...cache.keys()]).toEqual(['fresh']);
  });

  it('falls back to dropping the oldest when nothing has expired', () => {
    const now = Date.now();
    const cache = new Map<string, ScanCacheEntry>([
      ['first', entry(now)],
      ['second', entry(now)],
      ['third', entry(now)],
    ]);

    evictScans(cache, 2);

    // Under the cap, and the survivors are the most recently inserted.
    expect(cache.size).toBe(1);
    expect(cache.has('third')).toBe(true);
  });

  it('never empties a cache that is under the cap', () => {
    const cache = new Map<string, ScanCacheEntry>([['fresh', entry(Date.now())]]);

    evictScans(cache, 500);

    expect(cache.size).toBe(1);
  });
});
