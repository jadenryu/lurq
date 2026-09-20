/**
 * New-major alerts for accounts that use lurq from the CLI without connecting
 * the repo: the evidence is their own recent `check-upgrade` runs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/repos', () => ({ reposDeclaring: vi.fn(async () => []) }));
vi.mock('../src/db/alerts', () => ({
  cliUpgradeWatchers: vi.fn(async () => []),
  // Mirrors the real signature: the rows that were WRITTEN, not a count. A
  // count here used to be close enough; it is not any more, because
  // emitPublishAlerts now reads `repoId` off these rows to decide which repos
  // get a run started.
  insertAlerts: vi.fn(async (_db: unknown, rows: { repoId?: number | null }[]) =>
    rows.map((row, i) => ({ id: i + 1, repoId: row.repoId ?? null })),
  ),
}));
// Publishing an alert now also starts a run. Stubbed so these tests stay about
// alert fan-out, and so none of them reaches api.github.com.
vi.mock('../src/github/dispatch', () => ({
  dispatchForAlerts: vi.fn(async () => ({
    dispatched: 0,
    'not-armed': 0,
    'permission-denied': 0,
    'no-workflow': 0,
    failed: 0,
  })),
}));

import * as alertsDb from '../src/db/alerts';
import * as reposDb from '../src/db/repos';
import type { RepoRow } from '../src/db/schema';
import { draftCliAlert, emitPublishAlerts } from '../src/github/alerts';
import * as dispatch from '../src/github/dispatch';

const db = {} as never;
const watcher = { ownerId: 'user_cli', repoFullName: 'acme/web', lastToVersion: '18.2.0' };

describe('draftCliAlert', () => {
  it('alerts when the release is a major past the last upgrade', () => {
    expect(draftCliAlert(watcher, 'stripe', '19.0.0')).toMatchObject({
      ownerId: 'user_cli',
      repoId: null,
      repoFullName: 'acme/web',
      range: '18.2.0',
      fromVersion: '18.2.0',
      toVersion: '19.0.0',
      // We never saw the declared range, so this is never the urgent case.
      inRange: false,
    });
  });

  it('stays silent when the last upgrade already reached that major', () => {
    expect(
      draftCliAlert({ ...watcher, lastToVersion: '19.0.0-beta.1' }, 'stripe', '19.0.0'),
    ).toBeNull();
    expect(draftCliAlert({ ...watcher, lastToVersion: '19.1.0' }, 'stripe', '19.2.0')).toBeNull();
  });
});

describe('emitPublishAlerts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('alerts a CLI-only repo from its upgrade runs', async () => {
    vi.mocked(alertsDb.cliUpgradeWatchers).mockResolvedValueOnce([watcher]);
    const written = await emitPublishAlerts(
      db,
      'stripe',
      { latestVersion: '18.9.0' },
      { latestVersion: '19.0.0' },
    );
    expect(written).toBe(1);
    const rows = vi.mocked(alertsDb.insertAlerts).mock.calls[0]![1];
    expect(rows[0]).toMatchObject({ repoId: null, repoFullName: 'acme/web' });
  });

  it('alerts a repo that is both connected and CLI-reported once, as the connected repo', async () => {
    vi.mocked(reposDb.reposDeclaring).mockResolvedValueOnce([
      {
        id: 7,
        ownerId: 'user_cli',
        fullName: 'acme/web',
        manifests: [{ path: 'package.json', deps: { stripe: '^18.0.0' } }],
        drift: null,
      } as unknown as RepoRow,
    ]);
    vi.mocked(alertsDb.cliUpgradeWatchers).mockResolvedValueOnce([watcher]);
    await emitPublishAlerts(db, 'stripe', { latestVersion: '18.9.0' }, { latestVersion: '19.0.0' });
    const rows = vi.mocked(alertsDb.insertAlerts).mock.calls[0]![1];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ repoId: 7 });
  });

  it('writes nothing for a minor release', async () => {
    vi.mocked(alertsDb.cliUpgradeWatchers).mockResolvedValueOnce([watcher]);
    expect(
      await emitPublishAlerts(
        db,
        'stripe',
        { latestVersion: '18.9.0' },
        { latestVersion: '18.10.0' },
      ),
    ).toBe(0);
    expect(alertsDb.cliUpgradeWatchers).not.toHaveBeenCalled();
  });
});

/**
 * The join between an alert and a run.
 *
 * `insertAlerts` returns the rows it actually wrote, and this is where those
 * `repoId`s are turned back into the repos to dispatch for. Both directions of
 * that mapping fail silently if they are wrong — too few and a release never
 * starts a run, too many and lurq starts runs on repos it was not told about —
 * so neither is left to the integration.
 */
describe('emitPublishAlerts: starting a run', () => {
  beforeEach(() => vi.clearAllMocks());

  it('dispatches for the repo whose alert was newly written', async () => {
    const connected = {
      id: 7,
      ownerId: 'user_cli',
      fullName: 'acme/web',
      manifests: [{ path: 'package.json', deps: { stripe: '^18.0.0' } }],
      drift: null,
    } as unknown as RepoRow;
    vi.mocked(reposDb.reposDeclaring).mockResolvedValueOnce([connected]);

    await emitPublishAlerts(db, 'stripe', { latestVersion: '18.9.0' }, { latestVersion: '19.0.0' });

    expect(dispatch.dispatchForAlerts).toHaveBeenCalledTimes(1);
    const dispatched = vi.mocked(dispatch.dispatchForAlerts).mock.calls[0]![0];
    // The ROW, not the id: dispatching needs installationId and defaultBranch,
    // which only the row carries.
    expect(dispatched).toEqual([connected]);
  });

  it('dispatches nothing for a CLI-only alert, which has no installation', async () => {
    // `repoId` is null for an account with no connected repo, so there is no
    // installation to dispatch through and nothing to look up.
    vi.mocked(alertsDb.cliUpgradeWatchers).mockResolvedValueOnce([watcher]);
    await emitPublishAlerts(db, 'stripe', { latestVersion: '18.9.0' }, { latestVersion: '19.0.0' });
    expect(dispatch.dispatchForAlerts).not.toHaveBeenCalled();
  });

  it('does not dispatch when the release was already alerted', async () => {
    // A re-sync of an already-alerted publish inserts nothing — the unique
    // index drops it — so an empty return must mean no runs, without this
    // needing any dedup state of its own.
    vi.mocked(reposDb.reposDeclaring).mockResolvedValueOnce([
      {
        id: 7,
        ownerId: 'user_cli',
        fullName: 'acme/web',
        manifests: [{ path: 'package.json', deps: { stripe: '^18.0.0' } }],
        drift: null,
      } as unknown as RepoRow,
    ]);
    vi.mocked(alertsDb.insertAlerts).mockResolvedValueOnce([]);

    const written = await emitPublishAlerts(
      db,
      'stripe',
      { latestVersion: '18.9.0' },
      { latestVersion: '19.0.0' },
    );
    expect(written).toBe(0);
    expect(dispatch.dispatchForAlerts).not.toHaveBeenCalled();
  });
});
