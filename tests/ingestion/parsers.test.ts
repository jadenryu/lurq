import { describe, it, expect } from 'vitest';
import {
  parseNpmRegistry,
  parseGithubRepo,
  encodeNpmName,
} from '../../src/ingestion/sources/npmRegistry';
import {
  parseWeeklyDownloads,
  parseDownloadGrowth,
  last90DayRange,
  parseBulkWeekly,
} from '../../src/ingestion/sources/npmDownloads';
import { parseGithub } from '../../src/ingestion/sources/github';
import {
  parseScorecard,
  parseAdvisoryKeys,
  parseAdvisoryDetail,
  severityFromCvss,
} from '../../src/ingestion/sources/depsDev';
import { parseBundleSize } from '../../src/ingestion/sources/bundlephobia';

describe('npm registry parser', () => {
  const packument = {
    name: 'react',
    'dist-tags': { latest: '18.3.1' },
    description: 'React is a JavaScript library for building user interfaces.',
    license: 'MIT',
    homepage: 'https://react.dev/',
    repository: { type: 'git', url: 'git+https://github.com/facebook/react.git' },
    maintainers: [{ name: 'fb' }, { name: 'gnoff' }],
    readme: '# React\nA library.',
    time: {
      created: '2011-10-26T17:46:21.942Z',
      modified: '2024-04-25T20:00:00.000Z',
      '18.3.1': '2024-04-25T19:00:00.000Z',
    },
    versions: { '18.3.1': { license: 'MIT' } },
  };

  it('extracts core metadata', () => {
    const d = parseNpmRegistry(packument);
    expect(d.name).toBe('react');
    expect(d.latestVersion).toBe('18.3.1');
    expect(d.license).toBe('MIT');
    expect(d.repo).toEqual({ owner: 'facebook', repo: 'react' });
    expect(d.repoUrl).toBe('https://github.com/facebook/react');
    expect(d.deprecated).toBe(false);
    expect(d.maintainersCount).toBe(2);
    expect(d.readme).toContain('React');
    expect(d.firstPublishedAt?.getUTCFullYear()).toBe(2011);
    expect(d.lastReleaseAt?.toISOString()).toBe('2024-04-25T19:00:00.000Z');
  });

  it('detects deprecation from the latest manifest', () => {
    const dep = { ...packument, versions: { '18.3.1': { deprecated: 'no longer maintained' } } };
    expect(parseNpmRegistry(dep).deprecated).toBe(true);
  });

  it('handles missing/empty data without throwing', () => {
    const d = parseNpmRegistry({});
    expect(d.latestVersion).toBeNull();
    expect(d.repo).toBeNull();
  });
});

describe('github repo URL parsing', () => {
  it('handles every common URL form', () => {
    const forms = [
      'git+https://github.com/facebook/react.git',
      'git://github.com/facebook/react.git',
      'https://github.com/facebook/react',
      'git@github.com:facebook/react.git',
      'https://github.com/facebook/react#readme',
    ];
    for (const f of forms) {
      expect(parseGithubRepo(f)).toEqual({ owner: 'facebook', repo: 'react' });
    }
    expect(parseGithubRepo('https://gitlab.com/x/y')).toBeNull();
    expect(parseGithubRepo(null)).toBeNull();
  });
});

describe('encodeNpmName', () => {
  it('encodes the slash in scoped names only', () => {
    expect(encodeNpmName('react')).toBe('react');
    expect(encodeNpmName('@scope/name')).toBe('@scope%2Fname');
  });
});

describe('npm downloads parsers', () => {
  it('parses weekly downloads', () => {
    expect(parseWeeklyDownloads({ downloads: 12345 })).toBe(12345);
    expect(parseWeeklyDownloads({})).toBeNull();
  });

  it('computes 90d growth as recent-vs-prior fraction', () => {
    const points = Array.from({ length: 90 }, (_, i) => ({
      day: `2024-01-${i}`,
      downloads: i < 60 ? 100 : 150, // last 30 of the trailing 60 are higher
    }));
    expect(parseDownloadGrowth({ downloads: points })).toBeCloseTo(0.5, 5);
    // Rounded to 3 decimals — no long precision tail ships in responses.
    const g = parseDownloadGrowth({ downloads: points })!;
    expect(g).toBe(Math.round(g * 1000) / 1000);
  });

  it('returns null with insufficient data', () => {
    expect(parseDownloadGrowth({ downloads: [{ day: 'x', downloads: 1 }] })).toBeNull();
  });

  it('builds a valid YYYY-MM-DD:YYYY-MM-DD 90-day range', () => {
    const range = last90DayRange(new Date('2026-06-20T00:00:00Z'));
    expect(range).toBe('2026-03-22:2026-06-20');
  });

  it('parses bulk weekly responses (multi and single forms)', () => {
    const multi = parseBulkWeekly(
      { lodash: { downloads: 100, package: 'lodash' }, missing: null },
      ['lodash', 'missing'],
    );
    expect(multi.get('lodash')).toBe(100);
    expect(multi.get('missing')).toBeNull();

    const single = parseBulkWeekly({ downloads: 42, package: 'react' }, ['react']);
    expect(single.get('react')).toBe(42);
  });
});

describe('github parser', () => {
  const now = new Date('2024-06-01T00:00:00Z');
  const json = {
    data: {
      repository: {
        stargazerCount: 1000,
        isArchived: false,
        openIssues: { totalCount: 50 },
        closedIssues: { totalCount: 150 },
        releases: {
          nodes: [
            { createdAt: '2024-05-01T00:00:00Z' },
            { createdAt: '2024-01-01T00:00:00Z' },
            { createdAt: '2022-01-01T00:00:00Z' },
          ],
        },
      },
    },
  };

  it('extracts signals and counts releases within 12 months', () => {
    const d = parseGithub(json, now)!;
    expect(d.stars).toBe(1000);
    expect(d.openIssues).toBe(50);
    expect(d.closedIssues).toBe(150);
    expect(d.archived).toBe(false);
    expect(d.lastReleaseAt?.toISOString()).toBe('2024-05-01T00:00:00.000Z');
    expect(d.releasesLast12mo).toBe(2);
  });

  it('returns null when the repo is missing', () => {
    expect(parseGithub({ data: { repository: null } })).toBeNull();
  });
});

describe('deps.dev parsers', () => {
  it('maps CVSS scores to severity buckets', () => {
    expect(severityFromCvss(9.5)).toBe('critical');
    expect(severityFromCvss(7)).toBe('high');
    expect(severityFromCvss(5)).toBe('moderate');
    expect(severityFromCvss(1)).toBe('low');
    expect(severityFromCvss(0)).toBe('info');
    expect(severityFromCvss(null)).toBe('moderate');
  });

  it('parses scorecard, advisory keys, and advisory details', () => {
    expect(parseScorecard({ scorecard: { overallScore: 8.2 } })).toBe(8.2);
    expect(parseScorecard({})).toBeNull();
    expect(parseAdvisoryKeys({ advisoryKeys: [{ id: 'GHSA-a' }, { id: 'GHSA-b' }] })).toEqual([
      'GHSA-a',
      'GHSA-b',
    ]);
    expect(
      parseAdvisoryDetail({ advisoryKey: { id: 'GHSA-a' }, title: 'XSS', cvss3Score: 7.5 }),
    ).toEqual({ id: 'GHSA-a', severity: 'high', summary: 'XSS' });
  });
});

describe('bundlephobia parser', () => {
  it('converts gzip bytes to KB', () => {
    expect(parseBundleSize({ gzip: 12288 })).toBe(12);
    expect(parseBundleSize({})).toBeNull();
  });
});
