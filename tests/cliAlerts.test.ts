/**
 * New-major alerts for accounts that use lurq from the CLI without connecting
 * the repo: the evidence is their own recent `check-upgrade` runs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/repos', () => ({ reposDeclaring: vi.fn(async () => []) }));
vi.mock('../src/db/alerts', () => ({
  cliUpgradeWatchers: vi.fn(async () => []),
  insertAlerts: vi.fn(async (_db: unknown, rows: unknown[]) => rows.length),
}));

import * as alertsDb from '../src/db/alerts';
import * as reposDb from '../src/db/repos';
import type { RepoRow } from '../src/db/schema';
import { draftCliAlert, emitPublishAlerts } from '../src/github/alerts';

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
    expect(draftCliAlert({ ...watcher, lastToVersion: '19.0.0-beta.1' }, 'stripe', '19.0.0')).toBeNull();
    expect(draftCliAlert({ ...watcher, lastToVersion: '19.1.0' }, 'stripe', '19.2.0')).toBeNull();
  });
});

describe('emitPublishAlerts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('alerts a CLI-only repo from its upgrade runs', async () => {
    vi.mocked(alertsDb.cliUpgradeWatchers).mockResolvedValueOnce([watcher]);
    const written = await emitPublishAlerts(db, 'stripe', { latestVersion: '18.9.0' }, { latestVersion: '19.0.0' });
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
    expect(await emitPublishAlerts(db, 'stripe', { latestVersion: '18.9.0' }, { latestVersion: '18.10.0' })).toBe(0);
    expect(alertsDb.cliUpgradeWatchers).not.toHaveBeenCalled();
  });
});
