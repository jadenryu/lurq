import { describe, it, expect, vi } from 'vitest';
import { stampFirstRequester, getContributionsByOwner } from '../src/db/packages';
import type { Database } from '../src/db/client';

describe('stampFirstRequester', () => {
  it('sets first_requested_by_owner_id to the requesting owner', async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    const db = { update } as unknown as Database;

    await stampFirstRequester(db, 'left-pad', 'user_x');

    expect(update).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({ firstRequestedByOwnerId: 'user_x' });
    // The IS NULL guard lives in the where clause (the race tie-breaker).
    expect(where).toHaveBeenCalledTimes(1);
  });
});

describe('getContributionsByOwner', () => {
  /** Two parallel selects (rows, then count) — a thenable builder resolves each. */
  function fakeDb(rows: unknown[], count: number): Database {
    let call = 0;
    const builder = (result: unknown) => {
      const b: Record<string, unknown> = {};
      b.from = () => b;
      b.where = () => b;
      b.orderBy = () => b;
      b.limit = () => b;
      b.offset = () => b;
      b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(result).then(res, rej);
      return b;
    };
    return {
      select: () => (call++ === 0 ? builder(rows) : builder([{ count }])),
    } as unknown as Database;
  }

  it('returns the owner\'s packages plus the total count', async () => {
    const rows = [
      { name: 'left-pad', category: 'utility', healthScore: 40, firstRequestedAt: new Date() },
    ];
    const res = await getContributionsByOwner(fakeDb(rows, 1), 'user_x');
    expect(res.total).toBe(1);
    expect(res.packages).toBe(rows);
  });

  it('defaults total to 0 when the count row is missing', async () => {
    const res = await getContributionsByOwner(fakeDb([], 0), 'user_x');
    expect(res.total).toBe(0);
    expect(res.packages).toEqual([]);
  });
});
