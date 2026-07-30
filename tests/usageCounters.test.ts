import { describe, it, expect, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { recordUsage, getUsageSummary, getUsageByTool, windowStart } from '../src/db/usage';
import type { Database } from '../src/db/client';

describe('recordUsage', () => {
  it('no-ops when ownerId is null/undefined/empty (never touches the db)', async () => {
    const insert = vi.fn();
    const db = { insert } as unknown as Database;
    await recordUsage(db, null, 'evaluate');
    await recordUsage(db, undefined, 'evaluate');
    await recordUsage(db, '', 'evaluate');
    expect(insert).not.toHaveBeenCalled();
  });

  it('fires an upsert when ownerId is present', async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));
    const db = { insert } as unknown as Database;
    await recordUsage(db, 'user_x', 'evaluate');
    expect(insert).toHaveBeenCalledTimes(1);
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });

  it('swallows db errors — a display-only counter never breaks the call', async () => {
    const db = {
      insert: () => ({
        values: () => ({ onConflictDoUpdate: () => Promise.reject(new Error('db down')) }),
      }),
    } as unknown as Database;
    await expect(recordUsage(db, 'user_x', 'evaluate')).resolves.toBeUndefined();
  });
});

function fakeAggDb(rows: unknown[]): Database {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = () => chain;
  chain.groupBy = () => chain;
  chain.orderBy = () => Promise.resolve(rows);
  return { select: () => chain } as unknown as Database;
}

/** Captures the rendered SQL so window/cast regressions are visible to a unit test. */
function fakeExecDb(rows: unknown[]) {
  const seen: SQL[] = [];
  const db = {
    execute: (q: SQL) => {
      seen.push(q);
      return Promise.resolve(rows);
    },
  } as unknown as Database;
  return { db, rendered: () => new PgDialect().sqlToQuery(seen[0]!) };
}

describe('windowStart', () => {
  /**
   * Regression guard. An uncast `CURRENT_DATE - $n` binds as an unspecified-type
   * parameter, Postgres resolves `date - date -> integer`, and the surrounding
   * comparison dies with `operator does not exist: date >= integer`. The mocked
   * db in these tests never builds real SQL, so assert on the rendered text.
   */
  it('casts the day count to int so date arithmetic resolves', () => {
    const { sql: text, params } = new PgDialect().sqlToQuery(windowStart(30));
    expect(text).toBe('CURRENT_DATE - ($1::int - 1)');
    expect(params).toEqual([30]);
  });
});

describe('getUsageSummary', () => {
  it('returns the daily series and picks today out of it', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { db } = fakeExecDb([
      { date: '2026-07-01', count: 3 },
      { date: today, count: 7 },
    ]);
    const res = await getUsageSummary(db, 'user_x', 30);
    expect(res.series).toEqual([
      { date: '2026-07-01', count: 3 },
      { date: today, count: 7 },
    ]);
    expect(res.today).toBe(7);
  });

  it('today is 0 when no row matches the current day', async () => {
    const { db } = fakeExecDb([{ date: '2020-01-01', count: 4 }]);
    const res = await getUsageSummary(db, 'user_x', 30);
    expect(res.today).toBe(0);
  });

  it('asks the db for a gap-free window, so zero-traffic days are still points', async () => {
    const { db, rendered } = fakeExecDb([]);
    await getUsageSummary(db, 'user_x', 30);
    const { sql: text, params } = rendered();
    // generate_series + LEFT JOIN is what makes the series gap-free; a plain
    // GROUP BY over the table would silently drop zero-count days and hand the
    // chart a non-uniform time axis.
    expect(text).toContain('generate_series');
    expect(text).toContain('left join');
    expect(text).toContain('coalesce(sum(u.count), 0)::int');
    expect(text).toContain('$1::int');
    expect(params).toEqual([30, 'user_x']);
  });
});

describe('getUsageByTool', () => {
  it('coerces counts to numbers', async () => {
    const db = fakeAggDb([
      { tool: 'evaluate', count: '12' },
      { tool: 'verify', count: 3 },
    ]);
    const res = await getUsageByTool(db, 'user_x', 30);
    expect(res).toEqual([
      { tool: 'evaluate', count: 12 },
      { tool: 'verify', count: 3 },
    ]);
  });
});
