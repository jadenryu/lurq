/**
 * GitHub raw README fallback (§9.6). The npm packument `readme` field is often
 * empty (e.g. zod), so we fetch the repo README directly when needed. Public
 * raw content needs no token.
 */
import { CACHE_TTL } from '../../core/constants';
import { httpRequest } from '../../core/http';

const HOST = 'raw.githubusercontent.com';
const CANDIDATES = ['README.md', 'readme.md', 'README.markdown', 'README'];

export async function fetchGithubReadme(
  owner: string,
  repo: string,
  fetchImpl?: typeof fetch,
): Promise<string | null> {
  for (const file of CANDIDATES) {
    const url = `https://${HOST}/${owner}/${repo}/HEAD/${file}`;
    try {
      const { data } = await httpRequest<string>(url, {
        host: HOST,
        ttlMs: CACHE_TTL.github,
        accept: 'text',
        retries: 0,
        fetchImpl,
      });
      if (data && data.trim().length > 0) return data;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}
