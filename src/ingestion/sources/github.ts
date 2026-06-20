/**
 * GitHub client (§9.3). One GraphQL call per repo fetches stars, issue counts,
 * archived flag, and recent releases (latest date + 12-month cadence).
 * Requires GITHUB_TOKEN; without it, the pipeline skips this source.
 */
import { CACHE_TTL } from '../../core/constants';
import { httpRequest } from '../../core/http';
import type { GithubRepoData } from '../types';

const HOST = 'api.github.com';
const ENDPOINT = `https://${HOST}/graphql`;

const QUERY = `query($owner:String!, $name:String!) {
  repository(owner:$owner, name:$name) {
    stargazerCount
    isArchived
    openIssues: issues(states:OPEN) { totalCount }
    closedIssues: issues(states:CLOSED) { totalCount }
    releases(first: 50, orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes { createdAt }
    }
  }
}`;

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export function parseGithub(json: any, now: Date = new Date()): GithubRepoData | null {
  const repo = json?.data?.repository;
  if (!repo) return null;

  const releaseNodes: { createdAt: string }[] = repo.releases?.nodes ?? [];
  const releaseDates = releaseNodes
    .map((n) => Date.parse(n.createdAt))
    .filter((ms) => !Number.isNaN(ms));
  const cutoff = now.getTime() - ONE_YEAR_MS;

  return {
    stars: typeof repo.stargazerCount === 'number' ? repo.stargazerCount : null,
    openIssues: repo.openIssues?.totalCount ?? null,
    closedIssues: repo.closedIssues?.totalCount ?? null,
    archived: Boolean(repo.isArchived),
    lastReleaseAt: releaseDates.length ? new Date(Math.max(...releaseDates)) : null,
    releasesLast12mo: releaseDates.filter((ms) => ms >= cutoff).length,
  };
}

export async function fetchGithubRepo(
  owner: string,
  repo: string,
  token: string,
  fetchImpl?: typeof fetch,
): Promise<GithubRepoData | null> {
  const body = JSON.stringify({ query: QUERY, variables: { owner, name: repo } });
  const { data } = await httpRequest<any>(ENDPOINT, {
    host: HOST,
    ttlMs: CACHE_TTL.github,
    method: 'POST',
    headers: {
      Authorization: `bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'lurq',
    },
    body,
    // Keep the auth token out of the cache key.
    cacheKey: `POST ${ENDPOINT} ${owner}/${repo}`,
    fetchImpl,
  });
  return parseGithub(data);
}
