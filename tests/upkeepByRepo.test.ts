/**
 * Per-repo upkeep activity against Postgres.
 *
 * The question this answers is one the dashboard cannot ask today: for THIS
 * repository, has the workflow ever actually run? A repo armed in the database
 * with the workflow never committed looks identical to one opening pull
 * requests weekly, and the armed count treats them the same.
 *
 * Runs only with LURQ_TEST_DATABASE_URL, and only ever touches rows this run
 * created — every row is tagged with a per-run owner id.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NewUpgradeRunRow } from '../src/db/schema';

const TEST_DB = process.env.LURQ_TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)('upkeepByRepo against Postgres', () => {
  const run = randomUUID().slice(0, 8);
  const owner = `test-upkeep-${run}`;
  /** A second owner, to prove the query never reaches across accounts. */
  const otherOwner = `test-upkeep-other-${run}`;
  const repo = (n: string) => `acme-${run}/${n}`;

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
    // Local test database only: exactly the rows these two owners created.
    await db.execute(sql`delete from upgrade_runs where owner_id in (${owner}, ${otherOwner})`);
    await close();
  });

  /**
   * One run row. `packageName` varies per call because the dedup index is
   * (ownerId, repoFullName, packageName, toVersion, runUrl) — reusing a name
   * would upsert over the previous row instead of adding one.
   */
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

  it('reports one entry per repository that has ever reported a run', async () => {
    await store.recordUpgradeRuns(db, [
      row({ repoFullName: repo('web'), packageName: 'cookie' }),
      row({ repoFullName: repo('web'), packageName: 'zod' }),
      row({ repoFullName: repo('api'), packageName: 'express' }),
    ]);

    const byRepo = await store.upkeepByRepo(db, owner);
    expect([...byRepo.keys()].sort()).toEqual([repo('api'), repo('web')]);
    expect(byRepo.get(repo('web'))!.runs).toBe(2);
    expect(byRepo.get(repo('api'))!.runs).toBe(1);
  });

  it('omits a repository with no runs, which is the caller’s "never reported"', async () => {
    const byRepo = await store.upkeepByRepo(db, owner);
    // Absence is the signal. It is deliberately NOT a zero row: a repo that
    // never reported and a repo that reported nothing are the same fact here.
    expect(byRepo.has(repo('never-connected'))).toBe(false);
  });

  it('counts only runs that reached a pull request as delivered', async () => {
    const repoFullName = repo('delivery');
    await store.recordUpgradeRuns(db, [
      row({ repoFullName, packageName: 'd-checked', status: 'checked' }),
      row({ repoFullName, packageName: 'd-skipped', status: 'skipped' }),
      row({ repoFullName, packageName: 'd-edited', status: 'edited' }),
      row({ repoFullName, packageName: 'd-pr', status: 'pr_open' }),
      row({ repoFullName, packageName: 'd-merged', status: 'merged' }),
      row({ repoFullName, packageName: 'd-failed', status: 'failed' }),
    ]);

    const upkeep = (await store.upkeepByRepo(db, owner)).get(repoFullName)!;
    expect(upkeep.runs).toBe(6);
    // `edited` is not delivered: the tree changed and no PR came of it.
    expect(upkeep.delivered).toBe(2);
    expect(upkeep.failed).toBe(1);
    // Only `checked` is analysed-only. Keeping this apart from
    // runs - delivered - failed is the whole point: that arithmetic folds in
    // `edited` and `skipped`, both of which are armed behaviour.
    expect(upkeep.analysedOnly).toBe(1);
  });

  it('separates analysed-only from every other reason a run delivered nothing', async () => {
    // The unsound version of this signal is `delivered === 0`, which is also
    // true of a healthy repo that had nothing worth a PR. Only an all-`checked`
    // history says the workflow never got past analysis.
    const repoFullName = repo('comment-mode');
    await store.recordUpgradeRuns(db, [
      row({ repoFullName, packageName: 'c-one', status: 'checked' }),
      row({ repoFullName, packageName: 'c-two', status: 'checked' }),
    ]);

    const upkeep = (await store.upkeepByRepo(db, owner)).get(repoFullName)!;
    expect(upkeep.runs).toBe(2);
    expect(upkeep.delivered).toBe(0);
    expect(upkeep.analysedOnly).toBe(upkeep.runs);
  });

  it('does not call a skipped or edited run analysed-only', async () => {
    const repoFullName = repo('acted');
    await store.recordUpgradeRuns(db, [
      row({ repoFullName, packageName: 'a-skipped', status: 'skipped' }),
      row({ repoFullName, packageName: 'a-edited', status: 'edited' }),
    ]);

    const upkeep = (await store.upkeepByRepo(db, owner)).get(repoFullName)!;
    expect(upkeep.runs).toBe(2);
    expect(upkeep.analysedOnly).toBe(0);
    expect(upkeep.delivered).toBe(0);
  });

  it('reports the most recent run, not an arbitrary one', async () => {
    const repoFullName = repo('recency');
    const older = new Date('2026-01-02T03:04:05Z');
    const newest = new Date('2026-06-07T08:09:10Z');
    await store.recordUpgradeRuns(db, [
      row({ repoFullName, packageName: 'r-old', createdAt: older }),
      row({ repoFullName, packageName: 'r-new', createdAt: newest }),
      row({ repoFullName, packageName: 'r-mid', createdAt: new Date('2026-03-01T00:00:00Z') }),
    ]);

    const upkeep = (await store.upkeepByRepo(db, owner)).get(repoFullName)!;
    expect(upkeep.lastRunAt).toBeInstanceOf(Date);
    expect(upkeep.lastRunAt.toISOString()).toBe(newest.toISOString());
  });

  it('keys on the repo name even when the run has no repo id', async () => {
    // repoId is null for a workflow running where lurq has no GitHub App
    // installation. Keying on it would hide exactly those repos, and the schema
    // says losing them would bias every impact figure.
    const repoFullName = repo('no-app-install');
    await store.recordUpgradeRuns(db, [
      row({ repoFullName, packageName: 'standalone', repoId: null, status: 'pr_open' }),
    ]);

    const upkeep = (await store.upkeepByRepo(db, owner)).get(repoFullName)!;
    expect(upkeep.runs).toBe(1);
    expect(upkeep.delivered).toBe(1);
  });

  it('never reaches across owners', async () => {
    const shared = repo('same-name');
    await store.recordUpgradeRuns(db, [
      { ...row({ repoFullName: shared, packageName: 'mine' }) },
      { ...row({ repoFullName: shared, packageName: 'theirs' }), ownerId: otherOwner },
    ]);

    expect((await store.upkeepByRepo(db, owner)).get(shared)!.runs).toBe(1);
    expect((await store.upkeepByRepo(db, otherOwner)).get(shared)!.runs).toBe(1);
  });

  it('returns an empty map for an owner with nothing recorded', async () => {
    expect((await store.upkeepByRepo(db, `test-upkeep-empty-${run}`)).size).toBe(0);
  });
});
