/**
 * Starting a run when a breaking release lands.
 *
 * The weekly cron matches how fast majors arrive but says nothing about when.
 * lurq learns of a publish within seconds and already knows which repos declare
 * the package, so an armed repo can hear about it the same day instead of up to
 * six days later.
 *
 * Two properties carry the whole feature, and neither is visible in a diff:
 *   · a dispatch sends NO inputs, because GitHub applies a workflow_dispatch
 *     input default on every dispatch — passing `mode` (or letting a default
 *     apply) would pin the run to whatever was baked into the file and skip the
 *     step that reads the repo's current dashboard setting;
 *   · nothing here is allowed to throw, because it hangs off the package sync,
 *     and a notification failing must never fail an ingest.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoPolicy } from '../src/github/types';
import type { RepoRow } from '../src/db/schema';

// importOriginal, so the real GithubAppError class survives and `instanceof`
// still means something — a hand-rolled stand-in would make the status mapping
// below pass for the wrong reason.
vi.mock('../src/github/app', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/github/app')>()),
  installationPost: vi.fn(),
}));

import * as app from '../src/github/app';
import { GithubAppError } from '../src/github/app';
import { dispatchForAlerts, dispatchUpgradeWorkflow, shouldDispatch } from '../src/github/dispatch';

const repo = (policy: Partial<RepoPolicy>, over: Partial<RepoRow> = {}): RepoRow =>
  ({
    id: 1,
    ownerId: 'user_1',
    installationId: 99,
    fullName: 'acme/web',
    defaultBranch: 'main',
    policy: { enabled: true, scope: 'blocking', autoMerge: false, ...policy },
    ...over,
  }) as RepoRow;

beforeEach(() => {
  vi.mocked(app.installationPost).mockReset();
  vi.mocked(app.installationPost).mockResolvedValue({} as never);
});

describe('shouldDispatch', () => {
  it('starts a run for an armed repo', () => {
    expect(shouldDispatch(repo({ enabled: true }))).toBe(true);
    expect(shouldDispatch(repo({ enabled: true, mode: 'fix' }))).toBe(true);
    expect(shouldDispatch(repo({ enabled: true, mode: 'pr' }))).toBe(true);
  });

  it('leaves an analyse-only repo alone', () => {
    // Not timidity: the user chose a weekly cadence for analysis, and turning
    // that into "whenever anything publishes" would change their cadence on
    // their behalf. An armed repo has already asked for pull requests.
    expect(shouldDispatch(repo({ enabled: false }))).toBe(false);
    expect(shouldDispatch(repo({ enabled: true, mode: 'comment' }))).toBe(false);
  });

  it('never dispatches a repo the master switch turned off', () => {
    // The precedence that `repoMode` exists to enforce, checked here too
    // because this is the call that would actually run something.
    expect(shouldDispatch(repo({ enabled: false, mode: 'pr' }))).toBe(false);
  });
});

describe('dispatchUpgradeWorkflow', () => {
  it('asks GitHub to run the workflow on the default branch', async () => {
    expect(await dispatchUpgradeWorkflow(repo({ enabled: true }))).toBe('dispatched');
    const [installationId, path, body] = vi.mocked(app.installationPost).mock.calls[0]!;
    expect(installationId).toBe(99);
    expect(path).toBe('/repos/acme/web/actions/workflows/lurq-upgrade.yml/dispatches');
    expect(body).toEqual({ ref: 'main' });
  });

  it('sends no inputs, so the run reads the dashboard like a scheduled one', () => {
    // If this ever carries `inputs`, LURQ_MODE arrives pre-filled and the
    // "Resolve mode" step is skipped — every lurq-triggered run would silently
    // use the mode baked into the file instead of the current setting.
    return dispatchUpgradeWorkflow(repo({ enabled: true })).then(() => {
      const body = vi.mocked(app.installationPost).mock.calls[0]![2] as Record<string, unknown>;
      expect(body).not.toHaveProperty('inputs');
      expect(Object.keys(body)).toEqual(['ref']);
    });
  });

  it('falls back to main when the repo records no default branch', async () => {
    await dispatchUpgradeWorkflow(repo({ enabled: true }, { defaultBranch: null }));
    expect(vi.mocked(app.installationPost).mock.calls[0]![2]).toEqual({ ref: 'main' });
  });

  it('does not call GitHub at all for an analyse-only repo', async () => {
    expect(await dispatchUpgradeWorkflow(repo({ enabled: false }))).toBe('not-armed');
    expect(app.installationPost).not.toHaveBeenCalled();
  });

  it('reports a missing permission as exactly that', async () => {
    // The expected state until the App is granted Actions: write. It has to be
    // distinguishable from a real failure, or the one actionable outage in this
    // feature reads as a bug.
    vi.mocked(app.installationPost).mockRejectedValue(new GithubAppError('nope', 403));
    expect(await dispatchUpgradeWorkflow(repo({ enabled: true }))).toBe('permission-denied');
  });

  it('reports an uncommitted workflow separately', async () => {
    // GitHub answers 404 both for a workflow file that was never committed and
    // for a repo the installation cannot see. Either way there is nothing to
    // run, and it is not worth retrying.
    vi.mocked(app.installationPost).mockRejectedValue(new GithubAppError('gone', 404));
    expect(await dispatchUpgradeWorkflow(repo({ enabled: true }))).toBe('no-workflow');
  });

  it('never throws, whatever GitHub does', async () => {
    vi.mocked(app.installationPost).mockRejectedValue(new Error('socket hang up'));
    await expect(dispatchUpgradeWorkflow(repo({ enabled: true }))).resolves.toBe('failed');
  });
});

describe('dispatchForAlerts', () => {
  it('tallies each outcome rather than reporting just a count', async () => {
    vi.mocked(app.installationPost)
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(new GithubAppError('nope', 403));
    const tally = await dispatchForAlerts([
      repo({ enabled: true }, { id: 1 }),
      repo({ enabled: true }, { id: 2 }),
      repo({ enabled: false }, { id: 3 }),
    ]);
    expect(tally.dispatched).toBe(1);
    expect(tally['permission-denied']).toBe(1);
    expect(tally['not-armed']).toBe(1);
  });

  it('keeps going when one repo is unusable', async () => {
    // A malformed policy makes `shouldDispatch` throw, which happens before the
    // per-call try. This runs off an ingest, so one bad row must not stop every
    // other repo from hearing about the release.
    const broken = {
      ...repo({ enabled: true }, { id: 1 }),
      policy: undefined,
    } as unknown as RepoRow;
    const tally = await dispatchForAlerts([broken, repo({ enabled: true }, { id: 2 })]);
    expect(tally.failed).toBe(1);
    expect(tally.dispatched).toBe(1);
  });
});
