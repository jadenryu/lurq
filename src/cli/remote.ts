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
import type { SelectionPolicy } from '../policy/types';

export class RemoteError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'RemoteError';
  }
}

/**
 * No key anywhere on this machine. Its own class, not a bare 401, because the
 * entry point answers it by offering setup, and a key the server *rejected*
 * must not trigger that: re-running setup will not fix a revoked key.
 */
export class MissingKeyError extends RemoteError {
  constructor(
    message = 'No API key configured. Run `npx lurqrun setup` to connect this machine; from an agent\'s shell it prints a sign-in link to give the user.',
  ) {
    super(message, 401);
    this.name = 'MissingKeyError';
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
  if (!key) throw new MissingKeyError();
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

/**
 * POST JSON with a timeout, mapping transport failures to RemoteError.
 *
 * Shared by the REST client and the MCP client below, which differ only in what
 * they send and how they read the reply. One copy means the "timed out" and
 * "could not reach" wording cannot drift apart, and the callers stay short
 * enough to see at a glance.
 */
async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs = 60_000,
  method: 'GET' | 'POST' | 'PUT' = 'POST',
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      // fetch rejects a GET that carries a body, even an empty one.
      body: method === 'GET' ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new RemoteError(aborted ? `Timed out calling ${url}` : `Could not reach ${url}`, 0);
  } finally {
    clearTimeout(timer);
  }
}

const post = <T>(path: string, body: unknown, opts: RemoteOptions = {}): Promise<T> =>
  request<T>('POST', path, body, opts);

async function request<T>(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body: unknown,
  opts: RemoteOptions = {},
): Promise<T> {
  const url = `${endpoint(opts.url)}${path}`;
  // `apiKey()` is evaluated here rather than inside postJson, so a missing key
  // throws before any request is built and needs no unwrapping downstream.
  const res = await postJson(
    url,
    body,
    { Authorization: `Bearer ${apiKey(opts.apiKey)}` },
    opts.timeoutMs,
    method,
  );

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
  const res = await postJson(
    url,
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } },
    {
      // The streamable-HTTP transport rejects a request that doesn't accept
      // both, even when it has already decided to answer with plain JSON.
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${apiKey(opts.apiKey)}`,
    },
    opts.timeoutMs,
  );

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
 * Read a JSON-RPC body, tolerating an SSE frame and a non-JSON error page.
 *
 * mcp/http.ts sets `enableJsonResponse`, so SSE does not happen today. The three
 * lines that handle it are what stop this file breaking silently if that flag is
 * ever flipped in the server it has no other link to.
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
  /** Absent from a server older than rename detection. */
  renamed?: { path: string; to: string[] }[];
  arityChanged: { path: string; from: number | null; to: number | null }[];
  typeOnlyRemoved: string[];
  newlyDeprecated: string[];
  inconclusive?: string;
  /**
   * May the agent attempt this one under the repo's policy? Absent from an older
   * server, and `!== false` is how every consumer reads it — an unannotated plan
   * must behave exactly as it did before scope enforcement shipped.
   */
  inScope?: boolean;
  /** Why not, when `inScope` is false. */
  scopeReason?: string;
}

export interface RemotePlan {
  upgrades: RemoteUpgrade[];
  omitted: number;
  pending: number;
  /** Declared dependencies lurq has no index entry for. */
  untracked: number;
  /** The policy scope applied, and where it came from. Absent from an older server. */
  scope?: 'security' | 'blocking' | 'all';
  scopeSource?: 'repo-policy' | 'unconnected';
  outOfScope?: number;
  /**
   * What the repository's dashboard setting says the job should do. Absent from
   * an older server, and absent for an unconnected checkout — in both cases the
   * workflow keeps the mode baked into it.
   */
  mode?: 'comment' | 'fix' | 'pr';
}

export function fetchUpgradePlan(
  deps: Record<string, string>,
  opts: RemoteOptions & { repo?: string | null } = {},
): Promise<RemotePlan> {
  // `repo` is what lets the server find this repository's policy. Omitted when
  // unknown (a laptop, not a runner), which the server reads as "ungoverned".
  const body = opts.repo ? { deps, repo: opts.repo } : { deps };
  return post<RemotePlan>('/upgrade-plan', body, opts);
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

/**
 * Send what a CI check concluded, so the dashboard can show it.
 *
 * `rejected` is the server's count of rows it refused to parse. Surfaced rather
 * than swallowed: a payload shape that drifts from the server's validator would
 * otherwise look exactly like a repo with nothing to report.
 */
export function reportUpgradeRuns(
  runs: ReportedRun[],
  opts: RemoteOptions = {},
): Promise<{ recorded: number; rejected: number }> {
  return post<{ recorded: number; rejected: number }>('/upgrade-runs', { runs }, opts);
}

/** The account's open urgent changes, worded for an agent. Null when there are none. */
export async function getAlerts(opts: RemoteOptions & { agent?: string } = {}): Promise<string | null> {
  const path = opts.agent ? `/alerts?agent=${encodeURIComponent(opts.agent)}` : '/alerts';
  return (await request<{ notice: string | null }>('GET', path, undefined, opts)).notice;
}

/** The account's selection policy, as the dashboard would save it. */
export async function getPolicy(opts: RemoteOptions = {}): Promise<SelectionPolicy> {
  return (await request<{ policy: SelectionPolicy }>('GET', '/policy', undefined, opts)).policy;
}

/**
 * Replace the policy. The server rejects a key without policy:write (403).
 * `previous` is absent from a server older than policy history.
 */
export function putPolicy(
  policy: SelectionPolicy,
  opts: RemoteOptions = {},
): Promise<{ policy: SelectionPolicy; previous?: SelectionPolicy }> {
  return request('PUT', '/policy', { policy }, opts);
}

export interface RemotePolicyChange {
  actor: string;
  /** ISO timestamp. */
  at: string;
  changes: string[];
}

export interface RemoteDecision {
  packageName: string;
  rule: string;
  action: 'blocked' | 'warned';
  count: number;
  lastDay: string;
}

export async function getPolicyHistory(opts: RemoteOptions = {}): Promise<RemotePolicyChange[]> {
  return (await request<{ changes: RemotePolicyChange[] }>('GET', '/policy/history', undefined, opts))
    .changes;
}

export async function getPolicyDecisions(
  days: number,
  opts: RemoteOptions = {},
): Promise<RemoteDecision[]> {
  const path = `/policy/decisions?days=${encodeURIComponent(days)}`;
  return (await request<{ decisions: RemoteDecision[] }>('GET', path, undefined, opts)).decisions;
}

/** One server's scan as the CLI uploads it. Mirrors mcpScan/ingest's schema. */
export interface UploadedServer {
  alias: string;
  serverKey: string;
  configFingerprint: string;
  registry: string;
  packageName: string | null;
  pinnedVersion: string | null;
  transport: string;
  status: string;
  error: string | null;
  snapshot: unknown | null;
}

export interface McpScanUploadResult {
  servers: {
    alias: string;
    serverKey: string;
    deploymentId: number;
    change: 'first' | 'unchanged' | 'changed' | 'status_changed';
    worstSeverity: string | null;
    since: { at: string; severity: string; summary: string; rugPull: string[] } | null;
  }[];
  rejected: { index: number; alias: string | null; reason: string }[];
}

/**
 * Record a scan under the key's account. Private to that account; published
 * servers are offered as corroboration unless `contribute` is false.
 */
export function uploadMcpScan(
  body: { source: 'cli' | 'ci'; clientVersion: string; contribute: boolean; servers: UploadedServer[] },
  opts: RemoteOptions = {},
): Promise<McpScanUploadResult> {
  return post<McpScanUploadResult>('/mcp-scans', body, { timeoutMs: 120_000, ...opts });
}

/** One pinned remote MCP endpoint, measured against what lurq's probe reads now. */
export interface RemotePin {
  endpointId: number;
  url: string;
  note: string | null;
  pinnedAt: string;
  status: string | null;
  lastProbedAt: string | null;
  contractChanged: boolean;
  authChanged: boolean;
  openChanges: number;
  worstOpen: string | null;
}

export async function listMcpPins(opts: RemoteOptions = {}): Promise<RemotePin[]> {
  return (await request<{ pins: RemotePin[] }>('GET', '/mcp-pins', undefined, opts)).pins ?? [];
}

/** Pin a remote MCP server as it is now; re-pinning approves a change you reviewed. */
export async function pinMcpServer(server: string, note?: string, opts: RemoteOptions = {}): Promise<RemotePin | null> {
  return (await post<{ pin: RemotePin | null }>('/mcp-pins', { server, ...(note ? { note } : {}) }, opts)).pin;
}

export async function unpinMcpServer(server: string, opts: RemoteOptions = {}): Promise<boolean> {
  return (await post<{ unpinned: boolean }>('/mcp-pins/unpin', { server }, opts)).unpinned;
}

export async function acknowledgePublicMcpChange(changeId: number, opts: RemoteOptions = {}): Promise<boolean> {
  return (await post<{ acknowledged: boolean }>(`/mcp-public-changes/${changeId}/acknowledge`, {}, opts)).acknowledged;
}
