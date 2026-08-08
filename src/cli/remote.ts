/**
 * Client for the hosted lurq API, used by the commands that run on a user's
 * machine or in their CI rather than against a local database.
 *
 * The rest of the CLI talks to Postgres directly (`withDb` in commands.ts); that
 * is right for the operator and wrong here — a GitHub Actions runner has an API
 * key and no database. This module is the whole client: two calls, no SDK.
 */
import { DEFAULT_ENDPOINT } from '../core/constants';

export class RemoteError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'RemoteError';
  }
}

/** Endpoint the CLI talks to, with the same precedence `install` uses. */
export function endpoint(override?: string): string {
  const base = override ?? process.env.LURQ_ENDPOINT ?? DEFAULT_ENDPOINT;
  // The published endpoint is the MCP path; the REST routes sit beside it.
  return base.replace(/\/mcp\/?$/, '').replace(/\/$/, '');
}

function apiKey(override?: string): string {
  const key = override ?? process.env.LURQ_API_KEY;
  if (!key) {
    throw new RemoteError(
      'No API key. Set LURQ_API_KEY (create one at lurq.run/dashboard/keys).',
      401,
    );
  }
  return key;
}

/**
 * Pull a human-readable message out of an error body.
 *
 * The server speaks two envelopes and the client has to read both: the REST
 * handlers send `{ error: "some text" }`, but every auth and rate-limit
 * rejection goes through the JSON-RPC shape `{ error: { code, message } }`.
 * Reading `.error` as a string worked for the first and stringified the second
 * to `[object Object]`, which is what a user saw for every 401 the hosted API
 * has ever returned, i.e. exactly the case where the message mattered most.
 */
function errorText(body: unknown): string | undefined {
  const err = (body as { error?: unknown })?.error;
  if (typeof err === 'string') return err;
  const message = (err as { message?: unknown })?.message;
  return typeof message === 'string' ? message : undefined;
}

export interface RemoteOptions {
  url?: string;
  apiKey?: string;
  timeoutMs?: number;
}

async function post<T>(path: string, body: unknown, opts: RemoteOptions = {}): Promise<T> {
  const url = `${endpoint(opts.url)}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey(opts.apiKey)}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof RemoteError) throw err;
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new RemoteError(aborted ? `Timed out calling ${url}` : `Could not reach ${url}`, 0);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const detail = await res
      .json()
      .then(errorText)
      .catch(() => undefined);
    throw new RemoteError(detail ?? `${path} failed with HTTP ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

/** Response shape of `POST /upgrade-plan` — mirrors github/brief.ts. */
export interface RemoteUpgrade {
  package: string;
  fromVersion: string;
  toVersion: string;
  /** Manifests declaring it — every one needs bumping, not just the root. */
  declaredIn: { path: string; range: string }[];
  /** Migration sequence for a multi-major upgrade; empty when one hop suffices. */
  hops: {
    fromVersion: string;
    toVersion: string;
    verdict: RemoteUpgrade['verdict'];
    removed: string[];
    arityChanged: { path: string; from: number | null; to: number | null }[];
  }[];
  sequenceNote?: string;
  majorsBehind: number;
  advisories: number;
  deprecated: boolean;
  verdict: 'removes-exports' | 'arity-changed' | 'clean' | 'unknown';
  removed: string[];
  arityChanged: { path: string; from: number | null; to: number | null }[];
  typeOnlyRemoved: string[];
  newlyDeprecated: string[];
  inconclusive?: string;
}

export interface RemotePlan {
  upgrades: RemoteUpgrade[];
  omitted: number;
  pending: number;
  /** Declared dependencies lurq has no index entry for. */
  untracked: number;
}

export function fetchUpgradePlan(
  deps: Record<string, string>,
  opts: RemoteOptions = {},
): Promise<RemotePlan> {
  return post<RemotePlan>('/upgrade-plan', { deps }, opts);
}

export interface ReportedRun {
  repoFullName: string;
  packageName: string;
  fromVersion: string;
  toVersion: string;
  severity: 'blocking' | 'warning' | 'ok' | 'unverified';
  status: 'checked' | 'skipped' | 'edited' | 'pr_open' | 'merged' | 'failed';
  symbolsAffected?: string[];
  callSites?: number;
  callSiteFiles?: string[];
  filesChanged?: number;
  testsPassed?: boolean | null;
  prUrl?: string | null;
  runUrl?: string;
}

export function reportUpgradeRuns(
  runs: ReportedRun[],
  opts: RemoteOptions = {},
): Promise<{ recorded: number; rejected: number }> {
  return post('/upgrade-runs', { runs }, opts);
}
