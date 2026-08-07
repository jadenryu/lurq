import { describe, it, expect } from 'vitest';
import { handleDiffSurface, handleResolveSurface } from '../src/mcp/surfaceHandlers';
import type { Database } from '../src/db/client';

/**
 * These exercise the MISS path, which is the one that most easily degrades into
 * a lie: "we have not extracted this" must never render as "this has no
 * symbols". A fake db with no rows is exactly the miss condition.
 */
function emptyDb(): { db: Database; enqueued: string[] } {
  const enqueued: string[] = [];
  const chain = {
    from: () => chain,
    where: () => chain,
    innerJoin: () => chain,
    orderBy: () => chain,
    limit: async () => [],
    then: (r: (v: unknown[]) => unknown) => Promise.resolve([]).then(r),
  };
  const db = {
    select: () => chain,
    insert: () => ({
      values: (v: { specKey?: string }) => ({
        onConflictDoNothing: async () => {
          if (v?.specKey) enqueued.push(v.specKey);
        },
      }),
    }),
  } as unknown as Database;
  return { db, enqueued };
}

describe('resolve_surface — miss path', () => {
  it('returns UNKNOWN, never an empty symbol list presented as fact', async () => {
    const { db } = emptyDb();
    const res = await handleResolveSurface(db, { package: 'left-pad', version: '1.3.0' });
    expect(res.verdict).toBe('unknown');
    expect(res.symbols).toEqual([]);
    // The note must say so in words a model will actually read.
    expect(res.coverageNote).toMatch(/NOT evidence of absence/i);
    expect(res.observedAt).toBeNull();
  });

  it('queues the miss so the next caller gets a real answer', async () => {
    const { db, enqueued } = emptyDb();
    await handleResolveSurface(db, { package: 'left-pad', version: '1.3.0' });
    expect(enqueued).toContain('left-pad@1.3.0');
  });

  it('queues under the latest key when no version is given', async () => {
    const { db, enqueued } = emptyDb();
    await handleResolveSurface(db, { package: 'chalk' });
    expect(enqueued).toContain('chalk@latest');
  });

  it('always carries provenance fields, even on a miss', async () => {
    const { db } = emptyDb();
    const res = await handleResolveSurface(db, { package: 'x' });
    for (const k of ['verdict', 'class', 'tier', 'coverageNote', 'observedAt']) {
      expect(res).toHaveProperty(k);
    }
  });
});

describe('diff_surface — miss path', () => {
  it('refuses to report removals when a side was never extracted', async () => {
    const { db } = emptyDb();
    const res = await handleDiffSurface(db, {
      package: 'semver',
      fromVersion: '7.5.4',
      toVersion: '7.6.3',
    });
    expect(res.verdict).toBe('unknown');
    expect(res.removed).toEqual([]);
    expect(res.inconclusive).toMatch(/NOT evidence that symbols were removed/i);
  });

  it('queues both missing versions', async () => {
    const { db, enqueued } = emptyDb();
    await handleDiffSurface(db, { package: 'semver', fromVersion: '7.5.4', toVersion: '7.6.3' });
    expect(enqueued).toEqual(expect.arrayContaining(['semver@7.5.4', 'semver@7.6.3']));
  });
});
