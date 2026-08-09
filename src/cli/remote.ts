/**
 * Client for the hosted lurq API, used by the commands that run on a user's
 * machine or in their CI rather than against a local database.
 *
 * The rest of the CLI talks to Postgres directly (`withDb` in commands.ts); that
 * is right for the operator and wrong here — a GitHub Actions runner has an API
 * key and no database. This module is the whole client: two calls, no SDK.
 */
import { DEFAULT_ENDPOINT } from '../core/constants';
import { resolveApiKey, resolveEndpoint } from '../core/userConfig';

export class RemoteError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'RemoteError';
  }
}

/** Endpoint the CLI talks to, with the same precedence `setup` uses. */
export function endpoint(override?: string): string {
  const base = resolveEndpoint(override) ?? DEFAULT_ENDPOINT;
  // The published endpoint is the MCP path; the REST routes sit beside it.
  return base.replace(/\/mcp\/?$/, '').replace(/\/$/, '');
}

/** The `/mcp` JSON-RPC endpoint, whatever spelling of the base URL we were given. */
function mcpUrl(override?: string): string {
  return `${endpoint(override)}/mcp`;
}

export function apiKey(override?: string): string {
  const key = resolveApiKey(override);
  if (!key) {
    throw new RemoteError('No API key configured. Run `lurq setup` to connect this machine.', 401);
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

/**
 * Call one hosted MCP tool and return its parsed result.
 *
 * This is how the read commands work on a machine with no database. The hosted
 * `/mcp` route is stateless with JSON responses enabled (mcp/http.ts), so a bare
 * `tools/call` needs no `initialize` handshake, and every tool answers with a
 * single JSON text block: the exact object the local handler would have
 * returned, minus the null/empty fields `compact` strips. That is why the
 * renderers in commands.ts can format either source without knowing which
 * one produced the result.
 */
export async function callTool<T>(
  tool: string,
  args: Record<string, unknown>,
  opts: RemoteOptions = {},
): Promise<T> {
  const url = mcpUrl(opts.url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // The streamable-HTTP transport rejects a request that doesn't accept
        // both, even when it has already decided to answer with plain JSON.
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${apiKey(opts.apiKey)}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: tool, arguments: args },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof RemoteError) throw err;
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new RemoteError(aborted ? `Timed out calling ${url}` : `Could not reach ${url}`, 0);
  } finally {
    clearTimeout(timer);
  }

  const body = parseRpcBody(await res.text());
  if (!res.ok) {
    throw new RemoteError(errorText(body) ?? `${tool} failed with HTTP ${res.status}`, res.status);
  }
  const message = errorText(body);
  if (message) throw new RemoteError(message, 200);

  const result = (body as { result?: { content?: { type: string; text?: string }[]; isError?: boolean } })
    ?.result;
  const text = result?.content?.find((c) => c.type === 'text')?.text;
  if (text === undefined) throw new RemoteError(`${tool} returned no content.`, 502);
  // A tool that threw server-side comes back as a normal result with isError
  // set and the message as its text, so surface it instead of parsing it as data.
  if (result?.isError) throw new RemoteError(text, 200);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new RemoteError(`${tool} returned a non-JSON result: ${text.slice(0, 200)}`, 502);
  }
}

/**
 * Read a JSON-RPC response body that may have come back as SSE.
 *
 * The hosted route sets `enableJsonResponse`, so this is plain JSON in
 * practice, but the same transport falls back to an event stream depending on
 * how it is configured, and a self-hosted endpoint (`--url`) may well do that.
 * Pulling the last `data:` frame costs three lines and removes a class of
 * "unexpected token e in JSON" reports from anyone running their own service.
 */
function parseRpcBody(raw: string): unknown {
  const text = raw.trimStart().startsWith('{')
    ? raw
    : (raw.split('\n').filter((l) => l.startsWith('data:')).pop() ?? '').slice(5);
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
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
