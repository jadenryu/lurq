import { describe, it, expect } from 'vitest';
import { pruneUsageCounters } from '../src/db/usage';
import type { Database } from '../src/db/client';

/**
 * A database that reports rows and screams if anything tries to delete.
 * `deletes` is the assertion surface: production rows are only ever removed
 * when the caller explicitly asked for it.
 */
function fakeDb(stale: number, retained: number, oldest: string | null) {
  const deletes: unknown[] = [];
  const db = {
    select: () => ({ from: () => Promise.resolve([{ stale, retained, oldest }]) }),
    delete: (table: unknown) => {
      deletes.push(table);
      return { where: () => Promise.resolve(undefined) };
    },
  } as unknown as Database;
  return { db, deletes };
}

describe('pruneUsageCounters', () => {
  it('deletes NOTHING by default — apply must be explicit', async () => {
    const { db, deletes } = fakeDb(1200, 340, '2025-01-01');
    const r = await pruneUsageCounters(db);
    expect(deletes).toHaveLength(0);
    expect(r.applied).toBe(false);
    // It still reports honestly, so a dry run is useful on its own.
    expect(r).toMatchObject({ stale: 1200, retained: 340, oldest: '2025-01-01' });
  });

  it('deletes nothing when apply is explicitly false', async () => {
    const { db, deletes } = fakeDb(1200, 340, '2025-01-01');
    await pruneUsageCounters(db, { apply: false, keepDays: 1 });
    expect(deletes).toHaveLength(0);
  });

  it('deletes only when apply is true AND there is something stale', async () => {
    const { db, deletes } = fakeDb(1200, 340, '2025-01-01');
    const r = await pruneUsageCounters(db, { apply: true });
    expect(deletes).toHaveLength(1);
    expect(r.applied).toBe(true);
  });

  it('does not issue a delete when nothing is stale, even with --apply', async () => {
    const { db, deletes } = fakeDb(0, 500, '2026-08-01');
    await pruneUsageCounters(db, { apply: true });
    expect(deletes).toHaveLength(0);
  });

  it('reports an empty table without throwing', async () => {
    const { db } = fakeDb(0, 0, null);
    await expect(pruneUsageCounters(db)).resolves.toMatchObject({ stale: 0, oldest: null });
  });
});
