/**
 * GitHub App authentication + REST access for the repo autopilot.
 *
 * Two-step, per GitHub's App auth model: sign a short-lived RS256 JWT with the
 * App's private key, exchange it for an *installation* access token, then call
 * the REST API as that installation. The JWT is the only thing derived from the
 * private key, and it lives ~9 minutes; the installation token lives an hour and
 * is scoped to exactly the repos the user selected at install time.
 *
 * No Octokit: the whole surface we need is three endpoints and an RS256 sign,
 * which `node:crypto` already does. Adding `@octokit/auth-app` + its transitive
 * tree to sign one JWT would be the expensive way to save fifteen lines.
 *
 * Token caching is in-memory and per-process only — deliberately never routed
 * through the shared on-disk `httpRequest` cache, which would write live repo
 * credentials to `~/.lurq`.
 */
import { createSign } from 'node:crypto';
import { getConfig } from '../core/config';
import { HttpError, httpRequest } from '../core/http';

const API_HOST = 'api.github.com';
const API = `https://${API_HOST}`;

/** GitHub rejects a JWT with `exp` more than 10 minutes out; 9 leaves slack. */
const JWT_TTL_S = 9 * 60;
/** Re-mint an installation token this long before it actually expires. */
const TOKEN_SKEW_MS = 60_000;

export class GithubAppError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GithubAppError';
  }
}

export interface GithubAppCredentials {
  appId: string;
  privateKey: string;
}

/**
 * Read App credentials from config, or null when the App is not configured.
 *
 * Returning null rather than throwing is what lets `/repos` 404 cleanly on a
 * deployment that has not set the App up yet — the same shape `LURQ_ISSUER_SECRET`
 * uses for key issuance.
 */
export function githubAppCredentials(): GithubAppCredentials | null {
  const config = getConfig();
  const appId = config.LURQ_GITHUB_APP_ID;
  const rawKey = config.LURQ_GITHUB_APP_PRIVATE_KEY;
  if (!appId || !rawKey) return null;
  // Host env editors differ: Railway keeps real newlines, most CI secret fields
  // flatten them to a literal backslash-n. A PEM with the wrong one fails inside
  // crypto with an opaque error, so normalize here rather than debug it there.
  const privateKey = rawKey.includes('\\n') ? rawKey.replace(/\\n/g, '\n') : rawKey;
  return { appId, privateKey };
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Mint the App-level JWT. `iat` is backdated 60s to tolerate clock skew. */
export function appJwt(creds: GithubAppCredentials, now: Date = new Date()): string {
  const issued = Math.floor(now.getTime() / 1000) - 60;
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({ iat: issued, exp: issued + JWT_TTL_S, iss: creds.appId }),
  );
  const signature = createSign('RSA-SHA256')
    .update(`${header}.${payload}`)
    .sign(creds.privateKey);
  return `${header}.${payload}.${b64url(signature)}`;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<number, CachedToken>();

/** For tests, and for the connect flow after an install is revoked + re-added. */
export function clearInstallationTokenCache(): void {
  tokenCache.clear();
}

/**
 * Exchange the App JWT for an installation access token.
 *
 * A 404 here means the installation is gone (user uninstalled the App), which is
 * a normal, expected state — callers surface it as "reconnect" rather than an error.
 */
export async function installationToken(installationId: number): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt - TOKEN_SKEW_MS > Date.now()) return cached.token;

  const creds = githubAppCredentials();
  if (!creds) throw new GithubAppError('GitHub App is not configured.', 503);

  let res;
  try {
    res = await httpRequest<{ token?: string; expires_at?: string }>(
      `${API}/app/installations/${installationId}/access_tokens`,
      {
        host: API_HOST,
        ttlMs: 0, // never cache credentials to disk
        method: 'POST',
        headers: {
          Authorization: `Bearer ${appJwt(creds)}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      throw new GithubAppError('This GitHub installation no longer exists.', 404);
    }
    throw new GithubAppError(
      err instanceof Error ? err.message : 'Could not authenticate with GitHub.',
      502,
    );
  }

  const token = res.data?.token;
  if (!token) throw new GithubAppError('GitHub returned no installation token.', 502);

  const expiresAt = res.data.expires_at ? Date.parse(res.data.expires_at) : NaN;
  tokenCache.set(installationId, {
    token,
    // A token with an unparseable expiry is still valid; treat it as short-lived
    // rather than caching it forever on a malformed timestamp.
    expiresAt: Number.isNaN(expiresAt) ? Date.now() + 5 * 60_000 : expiresAt,
  });
  return token;
}

/** Authenticated REST GET as an installation. */
export async function installationGet<T>(
  installationId: number,
  path: string,
): Promise<T> {
  const token = await installationToken(installationId);
  const res = await httpRequest<T>(`${API}${path}`, {
    host: API_HOST,
    ttlMs: 0, // repo state changes under us; a cached manifest is a wrong answer
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  return res.data;
}
