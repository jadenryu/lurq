import { describe, it, expect } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { SQL } from 'drizzle-orm';
import { startSyncRun } from '../src/db/packages';
import { syncRuns } from '../src/db/schema';
import type { Database } from '../src/db/client';

/**
 * `startSyncRun` sweeps abandoned `running` rows before inserting its own. The
 * danger is not that the sweep misses one — it is that it closes a run that is
 * still going. Two schedulers currently fire the same cron seconds apart, so a
 * sweep that keyed on `status = 'running'` alone would have each run declare the
 * other dead. These pin the age bound that stops it.
 */
async function capturedWhere(): Promise<SQL> {
  let where: SQL | undefined;
  const db = {
    update: () => ({
      set: () => ({
        where: (w: SQL) => {
          where = w;
          return Promise.resolve();
        },
      }),
    }),
    insert: () => ({
      values: () => ({ returning: () => Promise.resolve([{ id: 1 }]) }),
    }),
  } as unknown as Database;

  await startSyncRun(db);
  expect(where).toBeDefined();
  return where!;
}

describe('abandoned sync run reaper', () => {
  it('only touches rows that are both running and old', async () => {
    // A driverless drizzle renders SQL without connecting; toSQL never executes.
    const { sql, params } = drizzle({} as never)
      .update(syncRuns)
      .set({ status: 'failed' })
      .where(await capturedWhere())
      .toSQL();

    expect(sql.toLowerCase()).toMatch(/where .*"status" = .* and .*"started_at" < /);
    expect(params).toContain('running');
  });

  it('cannot close a run that started moments ago', async () => {
    const { params } = drizzle({} as never)
      .update(syncRuns)
      .set({ status: 'failed' })
      .where(await capturedWhere())
      .toSQL();

    // The timestamp column's mapper renders the bound Date as an ISO string.
    const iso = params.find(
      (p): p is string => typeof p === 'string' && !Number.isNaN(Date.parse(p)) && p.includes('T'),
    );
    expect(iso).toBeDefined();
    const ageMs = Date.now() - Date.parse(iso!);
    // Comfortably older than the ~20 minutes a full sync takes, and older still
    // than the seconds separating two schedulers on the same cron tick.
    expect(ageMs).toBeGreaterThan(60 * 60 * 1000);
  });
});
