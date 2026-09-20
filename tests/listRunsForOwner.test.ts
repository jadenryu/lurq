/**
 * The cross-repo run query behind the autopilot log.
 *
 * `listRunsForRepo` answers "what happened to this repo". This answers "what has
 * lurq done at all", which is the question someone asks after arming the
 * autopilot and seeing no pull requests — and the one the dashboard could not
 * answer anywhere.
 *
 * The case worth pinning is the null `repoId`: a run reported from a repository
 * lurq has no GitHub App installation on has no repo row to join to, and those
 * are exactly the installs that are hardest to debug. A query that quietly
 * dropped them would make the log least useful where it is needed most.
 *
 * Runs only with LURQ_TEST_DATABASE_URL, and only ever touches rows tagged with
 * this run's own owner ids.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NewUpgradeRunRow } from '../src/db/schema';

const TEST_DB = process.env.LURQ_TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)('listRunsForOwner against Postgres', () => {
  const run = randomUUID().slice(0, 8);
  const owner = `test-runs-${run}`;
  const otherOwner = `test-runs-other-${run}`;

  let db: import('../src/db/client').Database;
  let close: () => Promise<void>;
  let store: typeof import('../src/db/upgradeRuns');
  let sql: typeof import('drizzle-orm').sql;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    const { createDb } = await import('../src/db/client');
    store = await import('../src/db/upgradeRuns');
    ({ sql } = await import('drizzle-orm'));
    const handle = createDb({ max: 4 });
    db = handle.db;
    close = handle.close;
  });

  afterAll(async () => {
    await db.execute(sql`delete from upgrade_runs where owner_id in (${owner}, ${otherOwner})`);
    await close();
  });

  const row = (
    over: Partial<NewUpgradeRunRow> & { repoFullName: string; packageName: string },
  ): NewUpgradeRunRow => ({
    ownerId: owner,
    fromVersion: '1.0.0',
    toVersion: '2.0.0',
    severity: 'blocking',
    status: 'checked',
    ...over,
  });

  it('returns runs from every repository, newest first', async () => {
    await store.recordUpgradeRuns(db, [
      row({
        repoFullName: `acme-${run}/web`,
        packageName: 'cookie',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      }),
      row({
        repoFullName: `acme-${run}/api`,
        packageName: 'express',
        createdAt: new Date('2026-03-01T00:00:00Z'),
      }),
      row({
        repoFullName: `acme-${run}/cli`,
        packageName: 'zod',
        createdAt: new Date('2026-02-01T00:00:00Z'),
      }),
    ]);

    const runs = await store.listRunsForOwner(db, owner);
    expect(runs.map((r) => r.packageName)).toEqual(['express', 'zod', 'cookie']);
    // Three different repos, which is the whole point: the per-repo query would
    // have needed three calls and could not order across them.
    expect(new Set(runs.map((r) => r.repoFullName)).size).toBe(3);
  });

  it('includes a run from a repo with no GitHub App installation', async () => {
    // `repoId` is null for those, and they are the installs least likely to be
    // debuggable any other way.
    await store.recordUpgradeRuns(db, [
      row({ repoFullName: `acme-${run}/standalone`, packageName: 'standalone-pkg', repoId: null }),
    ]);

    const runs = await store.listRunsForOwner(db, owner);
    const found = runs.find((r) => r.packageName === 'standalone-pkg');
    expect(found).toBeDefined();
    expect(found!.repoId).toBeNull();
  });

  it('records the trigger, and keeps an absent one absent', async () => {
    // Null is every row written before the column existed. The log renders that
    // as "not recorded" rather than guessing a cause, so it must survive the
    // round trip as null instead of being defaulted on write.
    await store.recordUpgradeRuns(db, [
      row({ repoFullName: `acme-${run}/web`, packageName: 'triggered', trigger: 'dispatch' }),
      row({ repoFullName: `acme-${run}/web`, packageName: 'untriggered' }),
    ]);

    const runs = await store.listRunsForOwner(db, owner);
    expect(runs.find((r) => r.packageName === 'triggered')!.trigger).toBe('dispatch');
    expect(runs.find((r) => r.packageName === 'untriggered')!.trigger).toBeNull();
  });

  it('never reaches across owners', async () => {
    await store.recordUpgradeRuns(db, [
      {
        ...row({ repoFullName: `acme-${run}/shared`, packageName: 'theirs' }),
        ownerId: otherOwner,
      },
    ]);

    const mine = await store.listRunsForOwner(db, owner);
    expect(mine.some((r) => r.packageName === 'theirs')).toBe(false);
    expect((await store.listRunsForOwner(db, otherOwner)).map((r) => r.packageName)).toEqual([
      'theirs',
    ]);
  });

  it('returns an empty list for an owner with nothing recorded', async () => {
    expect(await store.listRunsForOwner(db, `test-runs-empty-${run}`)).toEqual([]);
  });
});
