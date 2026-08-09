import { describe, expect, it } from 'vitest';
import { draftAlert, newMajorRelease } from '../src/github/alerts';
import type { RepoRow } from '../src/db/schema';

describe('newMajorRelease', () => {
  it('fires only when the major moves', () => {
    expect(newMajorRelease({ latestVersion: '18.4.1' }, { latestVersion: '19.0.0' })).toBe('19.0.0');
    expect(newMajorRelease({ latestVersion: '18.4.1' }, { latestVersion: '18.5.0' })).toBeNull();
  });

  it('stays silent on a first ingest — an appearance is not a release event', () => {
    expect(newMajorRelease(null, { latestVersion: '19.0.0' })).toBeNull();
    expect(newMajorRelease({ latestVersion: null }, { latestVersion: '19.0.0' })).toBeNull();
  });

  it('never fires backwards, so an unpublish cannot look like a major', () => {
    expect(newMajorRelease({ latestVersion: '19.0.0' }, { latestVersion: '18.4.1' })).toBeNull();
  });

  it('ignores versions it cannot parse rather than guessing', () => {
    expect(newMajorRelease({ latestVersion: 'nightly' }, { latestVersion: '19.0.0' })).toBeNull();
  });
});

function repo(deps: Record<string, string>, extra: Partial<RepoRow> = {}): RepoRow {
  return {
    id: 7,
    ownerId: 'user_1',
    installationId: 1,
    fullName: 'acme/api',
    defaultBranch: 'main',
    isPrivate: false,
    policy: { enabled: false, scope: 'blocking', autoMerge: false },
    manifests: [{ path: 'package.json', deps }],
    installCommand: 'npm ci',
    drift: null,
    lastScanAt: null,
    lastScanError: null,
    createdAt: new Date(),
    ...extra,
  } as RepoRow;
}

describe('draftAlert', () => {
  it('marks a caret range as out of range — the repo is now a major behind', () => {
    const alert = draftAlert(repo({ stripe: '^18.0.0' }), 'stripe', '19.0.0');
    expect(alert).toMatchObject({ repoId: 7, packageName: 'stripe', range: '^18.0.0', inRange: false });
  });

  it('marks an open range as in range — the next clean install takes the major', () => {
    expect(draftAlert(repo({ stripe: '*' }), 'stripe', '19.0.0')?.inRange).toBe(true);
    expect(draftAlert(repo({ stripe: '>=18' }), 'stripe', '19.0.0')?.inRange).toBe(true);
  });

  it('skips a repo that does not declare the package', () => {
    expect(draftAlert(repo({ react: '^18.0.0' }), 'stripe', '19.0.0')).toBeNull();
  });

  it('finds the package in a workspace manifest, not just the root', () => {
    const monorepo = repo(
      { react: '^18.0.0' },
      {
        manifests: [
          { path: 'package.json', deps: { react: '^18.0.0' } },
          { path: 'packages/api/package.json', deps: { stripe: '^18.0.0' } },
        ],
      },
    );
    expect(draftAlert(monorepo, 'stripe', '19.0.0')?.range).toBe('^18.0.0');
  });

  it('carries the resolved version from the last scan, and null when it is uncapped out', () => {
    const scanned = repo(
      { stripe: '^18.0.0' },
      {
        drift: {
          depsDeclared: 1,
          depsTracked: 1,
          majorDrift: 0,
          anyDrift: 0,
          deprecated: 0,
          advisories: 0,
          deps: [
            {
              name: 'stripe',
              range: '^18.0.0',
              declaredIn: [{ path: 'package.json', range: '^18.0.0' }],
              resolved: '18.4.1',
              latest: '18.4.1',
              majorsBehind: 0,
              deprecated: false,
              advisories: 0,
            },
          ],
          transitive: null,
        },
      },
    );
    expect(draftAlert(scanned, 'stripe', '19.0.0')?.fromVersion).toBe('18.4.1');
    // Never scanned, or beyond the capped detail list: no resolved version is a
    // gap in our data, recorded as null rather than filled in from the range.
    expect(draftAlert(repo({ stripe: '^18.0.0' }), 'stripe', '19.0.0')?.fromVersion).toBeNull();
  });
});
