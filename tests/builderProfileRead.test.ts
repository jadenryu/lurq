/**
 * Pinned: a profile's GitHub reads never turn a failure into a false answer.
 * A rate limit is an error, not "no such profile"; more than one page of repos
 * is followed and a cut-off list says so; a typed repo is scanned once whatever
 * its case; and a profile with unread repos is only cached briefly.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listRepos, manifestTries, nextPageUrl, REPO_PAGES } from '../src/github/builderProfile';
import { GitHubUnavailableError } from '../src/github/publicScan';
import { profileTtl } from '../src/mcp/http';

afterEach(() => vi.unstubAllGlobals());

const page = (n: number, next: boolean) =>
  new Response(JSON.stringify(Array.from({ length: n }, (_, i) => ({ name: `r${i}` }))), {
    status: 200,
    headers: next ? { link: '<https://api.github.com/user/1/repos?page=2>; rel="next", <https://api.github.com/user/1/repos?page=9>; rel="last"' } : {},
  });

describe('nextPageUrl', () => {
  it('reads the next link and nothing else', () => {
    expect(
      nextPageUrl('<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=5>; rel="last"'),
    ).toBe('https://api.github.com/x?page=2');
    expect(nextPageUrl('<https://api.github.com/x?page=1>; rel="prev"')).toBeNull();
    expect(nextPageUrl(null)).toBeNull();
  });
});

describe('listRepos', () => {
  it('is null only when GitHub says the login does not exist', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    await expect(listRepos('nobody')).resolves.toBeNull();
  });

  it('throws on a rate limit or a timeout instead of calling the profile missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })));
    await expect(listRepos('someone')).rejects.toBeInstanceOf(GitHubUnavailableError);
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))));
    await expect(listRepos('someone')).rejects.toBeInstanceOf(GitHubUnavailableError);
  });

  it('follows next pages and marks the list capped when GitHub has more', async () => {
    const fetchMock = vi.fn(async () => page(100, true));
    vi.stubGlobal('fetch', fetchMock);
    const listed = await listRepos('prolific');
    expect(fetchMock).toHaveBeenCalledTimes(REPO_PAGES);
    expect(listed).toMatchObject({ capped: true });
    expect(listed!.repos).toHaveLength(REPO_PAGES * 100);
  });

  it('is not capped when the last page has no next link', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(page(100, true)).mockResolvedValueOnce(page(7, false));
    vi.stubGlobal('fetch', fetchMock);
    const listed = await listRepos('some');
    expect(listed).toMatchObject({ capped: false });
    expect(listed!.repos).toHaveLength(107);
  });

  it('keeps the pages it read when a later page fails, and marks them capped', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(page(100, true)).mockResolvedValueOnce(new Response('{}', { status: 502 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(listRepos('some')).resolves.toMatchObject({ capped: true, repos: expect.any(Array) });
  });
});

describe('manifestTries', () => {
  it('puts the typed repo first once, in GitHub spelling, whatever case was typed', () => {
    expect(manifestTries(['api', 'MyRepo', 'web'], 'myrepo', 10)).toEqual(['MyRepo', 'api', 'web']);
  });

  it('keeps an unlisted typed repo and caps the list', () => {
    expect(manifestTries(['a', 'b', 'c'], 'Private', 2)).toEqual(['Private', 'a']);
  });
});

describe('profileTtl', () => {
  const profile = (unread: string[]) =>
    ({
      repos: [],
      coverage: { reposListed: 3, reposCapped: false, unreadManifests: unread },
    }) as unknown as Parameters<typeof profileTtl>[0];

  it('holds a profile with unread repos only briefly, so the next scan can read them', () => {
    expect(profileTtl(profile(['web']))).toBeLessThan(profileTtl(profile([])));
  });
});
