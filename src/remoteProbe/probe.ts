/**
 * Probe one remote MCP endpoint the way a client first meets it — with no
 * credentials — and report what that meeting establishes.
 *
 * Order of attempts:
 *
 *   1. A stateless 2026-07-28 `tools/list` POST. Current servers answer it
 *      directly; it is also one request, which matters across ten thousand
 *      endpoints.
 *   2. The SDK over Streamable HTTP with the `initialize` handshake, for servers
 *      on earlier revisions that need a session.
 *   3. Legacy HTTP+SSE, for servers that never moved off it.
 *
 * A 401/403 at any point ends the contract read and starts OAuth discovery
 * (`./oauth.ts`). Every network call goes through the SSRF-safe fetch, so a
 * registry entry cannot turn the prober against lurq's own network.
 *
 * Never throws. Every failure becomes a status with our own words for it; a
 * response body is never copied into an error, because it is someone else's
 * text and may be addressed to a model.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod/v4';
import { VERSION } from '../core/constants';
import { UnsafeUrlError, type SafeFetch } from '../core/safeFetch';
import { addTools, emptySnapshot, LIMITS, type Snapshot } from '../mcpScan/snapshot';
import type { McpTool } from '../surface/mcp';
import { discoverOAuth, parseWwwAuthenticate } from './oauth';
import type { AuthProfile, DeclaredHeader, EndpointStatus, ProbeResult, ProtocolMode } from './types';
import { endpointIdentity } from './url';

export const PROBE_PROTOCOL_VERSION = '2026-07-28';
const CLIENT_INFO = { name: 'lurq-probe', version: VERSION };

export const PROBE_DEFAULTS = {
  /** Whole probe, discovery included. */
  budgetMs: 25_000,
  requestTimeoutMs: 10_000,
  /** Tool pages read at most; the snapshot's own caps still apply. */
  maxPages: 20,
} as const;

export interface ProbeOptions {
  fetch: SafeFetch;
  declaredHeaders?: DeclaredHeader[];
  budgetMs?: number;
  requestTimeoutMs?: number;
  maxPages?: number;
}

class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    readonly wwwAuthenticate: string | null,
  ) {
    super(`HTTP ${status}`);
  }
}

function blankAuth(declared: DeclaredHeader[]): AuthProfile {
  return { mode: 'unknown', challengeStatus: null, oauth: null, declaredHeaders: declared };
}

function base(url: string, declared: DeclaredHeader[]): ProbeResult {
  return {
    url,
    status: 'unreachable',
    httpStatus: null,
    transport: null,
    protocolMode: null,
    protocolVersion: null,
    serverName: null,
    serverVersion: null,
    auth: blankAuth(declared),
    violations: [],
    snapshot: null,
    error: null,
    latencyMs: null,
    finalUrl: null,
  };
}

/** Map a thrown network error to a status and our own description. */
export function classifyNetworkError(err: unknown): { status: EndpointStatus; error: string } {
  if (err instanceof UnsafeUrlError) return { status: 'blocked', error: err.message };
  const e = err as { name?: string; code?: string; cause?: { code?: string; name?: string } };
  const code = e?.code ?? e?.cause?.code ?? '';
  const name = e?.name ?? e?.cause?.name ?? '';
  if (code === 'EPRIVATE') return { status: 'blocked', error: 'the hostname resolves to a private network address' };
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { status: 'dns_failed', error: 'the hostname does not resolve' };
  if (name === 'AbortError' || name === 'TimeoutError' || code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT' || code === 'ETIMEDOUT') {
    return { status: 'timeout', error: 'no response within the time limit' };
  }
  if (code === 'ETOOLARGE') return { status: 'protocol_error', error: 'the response was larger than lurq reads' };
  if (/CERT|SSL|TLS|ERR_TLS/i.test(code)) return { status: 'unreachable', error: `TLS failure (${code})` };
  return { status: 'unreachable', error: code ? `connection failed (${code})` : 'connection failed' };
}

function statusForHttp(status: number): EndpointStatus {
  if (status === 401 || status === 403) return 'auth_required';
  if (status === 404 || status === 410) return 'not_found';
  if (status >= 500) return 'server_error';
  return 'protocol_error';
}

/** Read one JSON-RPC response from a JSON or SSE body, matching the request id. */
async function readRpc(res: Response, id: number): Promise<Record<string, unknown> | null> {
  const type = res.headers.get('content-type') ?? '';
  const text = await res.text();
  if (type.includes('text/event-stream')) {
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (!data) continue;
      try {
        const msg = JSON.parse(data) as Record<string, unknown>;
        if (msg.id === id) return msg;
      } catch {
        /* keep scanning */
      }
    }
    return null;
  }
  try {
    const msg = JSON.parse(text) as unknown;
    return msg && typeof msg === 'object' && !Array.isArray(msg) ? (msg as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const meta = () => ({
  'io.modelcontextprotocol/protocolVersion': PROBE_PROTOCOL_VERSION,
  'io.modelcontextprotocol/clientInfo': CLIENT_INFO,
  'io.modelcontextprotocol/clientCapabilities': {},
});

interface ToolsRead {
  tools: unknown[][];
  truncated: boolean;
  serverName: string | null;
  serverVersion: string | null;
  protocolVersion: string | null;
}

/** Attempt 1: stateless `tools/list`. Null means "this server wants the older handshake". */
async function statelessToolsList(
  fetch: SafeFetch,
  url: string,
  opts: { signal: AbortSignal; maxPages: number },
  onFirst: (res: Response) => void,
): Promise<ToolsRead | null> {
  const pages: unknown[][] = [];
  let cursor: string | undefined;
  let info: Pick<ToolsRead, 'serverName' | 'serverVersion'> = { serverName: null, serverVersion: null };
  for (let page = 0; page < opts.maxPages; page++) {
    const id = page + 1;
    const res = await fetch(url, {
      method: 'POST',
      signal: opts.signal,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-method': 'tools/list',
        'mcp-protocol-version': PROBE_PROTOCOL_VERSION,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/list', params: { ...(cursor ? { cursor } : {}), _meta: meta() } }),
    });
    if (page === 0) onFirst(res);
    if (res.status === 401 || res.status === 403) {
      await res.body?.cancel().catch(() => {});
      throw new HttpStatusError(res.status, res.headers.get('www-authenticate'));
    }
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => {});
      if (page === 0 && [400, 404, 405, 406, 415].includes(res.status)) return null;
      throw new HttpStatusError(res.status, null);
    }
    const msg = await readRpc(res, id);
    const result = msg?.result as Record<string, unknown> | undefined;
    if (!result || !Array.isArray(result.tools)) {
      // An error (session required, unsupported version) or a non-MCP body.
      if (page === 0) return null;
      break;
    }
    pages.push(result.tools);
    const serverInfo = (result._meta as Record<string, unknown> | undefined)?.['io.modelcontextprotocol/serverInfo'] as
      | { name?: unknown; version?: unknown }
      | undefined;
    if (page === 0 && serverInfo) {
      info = {
        serverName: typeof serverInfo.name === 'string' ? serverInfo.name : null,
        serverVersion: typeof serverInfo.version === 'string' ? serverInfo.version : null,
      };
    }
    cursor = typeof result.nextCursor === 'string' && result.nextCursor ? result.nextCursor : undefined;
    if (!cursor) return { tools: pages, truncated: false, ...info, protocolVersion: PROBE_PROTOCOL_VERSION };
  }
  return { tools: pages, truncated: Boolean(cursor), ...info, protocolVersion: PROBE_PROTOCOL_VERSION };
}

const ToolsPage = z.looseObject({ tools: z.array(z.unknown()).optional(), nextCursor: z.string().optional() });

/** Attempts 2 and 3: the SDK handshake over Streamable HTTP, then SSE. */
async function handshakeToolsList(
  fetch: SafeFetch,
  url: string,
  kind: 'streamable-http' | 'sse',
  opts: { requestTimeoutMs: number; maxPages: number; signal?: AbortSignal },
): Promise<ToolsRead> {
  const client = new Client(CLIENT_INFO, { capabilities: {} });
  const target = new URL(url);
  const transport =
    kind === 'streamable-http'
      ? new StreamableHTTPClientTransport(target, {
          fetch: fetch as never,
          reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1_000, maxReconnectionDelay: 1_000, reconnectionDelayGrowFactor: 1 },
        })
      : new SSEClientTransport(target, { fetch: fetch as never, eventSourceInit: { fetch: fetch as never } });
  try {
    // The budget, not just the per-request timeout: two handshake attempts each
    // taking the full requestTimeoutMs would otherwise run well past the cap
    // this probe claims to hold, since the loop only checks it between attempts.
    await client.connect(transport, { timeout: opts.requestTimeoutMs, signal: opts.signal });
    const pages: unknown[][] = [];
    let cursor: string | undefined;
    for (let page = 0; page < opts.maxPages; page++) {
      const res = await client.request({ method: 'tools/list', params: cursor ? { cursor } : {} }, ToolsPage, {
        timeout: opts.requestTimeoutMs,
        signal: opts.signal,
      });
      pages.push(res.tools ?? []);
      cursor = res.nextCursor || undefined;
      if (!cursor) break;
    }
    const v = client.getServerVersion();
    return {
      tools: pages,
      truncated: Boolean(cursor),
      serverName: v?.name ?? null,
      serverVersion: v?.version ?? null,
      protocolVersion: (transport as { protocolVersion?: string }).protocolVersion ?? null,
    };
  } finally {
    await client.close().catch(() => {});
  }
}

/** Pull an HTTP status and challenge out of whatever the SDK threw. */
function httpFromSdkError(err: unknown): { status: number; wwwAuthenticate: string | null } | null {
  if (err instanceof HttpStatusError) return { status: err.status, wwwAuthenticate: err.wwwAuthenticate };
  const e = err as { code?: unknown; name?: string; message?: string };
  if (e?.name === 'UnauthorizedError') return { status: 401, wwwAuthenticate: null };
  if (typeof e?.code === 'number' && e.code >= 400 && e.code < 600) return { status: e.code, wwwAuthenticate: null };
  const m = /\b(?:HTTP|status(?: code)?)[\s:]*([45]\d\d)\b/i.exec(e?.message ?? '');
  return m ? { status: Number(m[1]), wwwAuthenticate: null } : null;
}

function buildSnapshot(read: ToolsRead): Snapshot {
  const snapshot = emptySnapshot();
  snapshot.serverInfo = { name: read.serverName, version: read.serverVersion, title: null };
  snapshot.protocolVersion = read.protocolVersion;
  snapshot.capabilities.tools = true;
  const seen = new Map<string, McpTool>();
  for (const page of read.tools) if (!addTools(page, seen, snapshot.issues)) break;
  snapshot.tools = [...seen.values()];
  if (read.truncated) {
    snapshot.issues.push({ list: 'tools', kind: 'truncated', detail: `still paginating after ${LIMITS.pages} pages` });
  }
  return snapshot;
}

export async function probeEndpoint(rawUrl: string, opts: ProbeOptions): Promise<ProbeResult> {
  const declared = opts.declaredHeaders ?? [];
  const identity = endpointIdentity(rawUrl);
  const out = base(identity?.url ?? rawUrl, declared);
  if (!identity) return { ...out, status: 'blocked', error: 'not an http(s) URL' };
  if (identity.templated) return { ...out, status: 'templated', error: 'the URL has placeholders that must be filled in first' };

  const started = Date.now();
  const budget = AbortSignal.timeout(opts.budgetMs ?? PROBE_DEFAULTS.budgetMs);
  const maxPages = Math.min(opts.maxPages ?? PROBE_DEFAULTS.maxPages, LIMITS.pages);
  const requestTimeoutMs = opts.requestTimeoutMs ?? PROBE_DEFAULTS.requestTimeoutMs;
  let challenge: { status: number; wwwAuthenticate: string | null } | null = null;
  let read: ToolsRead | null = null;
  let mode: ProtocolMode | null = null;
  let transport: ProbeResult['transport'] = null;

  try {
    read = await statelessToolsList(opts.fetch, identity.url, { signal: budget, maxPages }, (res) => {
      out.latencyMs = Date.now() - started;
      out.httpStatus = res.status;
      if (res.url && res.url !== identity.url) out.finalUrl = res.url;
    });
    if (read) {
      mode = 'stateless';
      transport = 'streamable-http';
    }
  } catch (err) {
    const http = httpFromSdkError(err);
    if (http) {
      out.httpStatus = http.status;
      if (http.status === 401 || http.status === 403) challenge = http;
      else return { ...out, status: statusForHttp(http.status), error: `HTTP ${http.status}`, auth: { ...out.auth, mode: 'unknown' } };
    } else {
      const c = classifyNetworkError(err);
      return { ...out, ...c, latencyMs: out.latencyMs ?? Date.now() - started };
    }
  }

  if (!read && !challenge) {
    for (const kind of ['streamable-http', 'sse'] as const) {
      if (budget.aborted) break;
      try {
        read = await handshakeToolsList(opts.fetch, identity.url, kind, { requestTimeoutMs, maxPages, signal: budget });
        mode = 'initialize';
        transport = kind;
        break;
      } catch (err) {
        const http = httpFromSdkError(err);
        if (http && (http.status === 401 || http.status === 403)) {
          challenge = http;
          out.httpStatus = http.status;
          break;
        }
        if (http) out.httpStatus = http.status;
        // A server that 404s on Streamable HTTP may still speak SSE; anything else is final.
        if (kind === 'sse' || (http && ![400, 404, 405].includes(http.status))) {
          const c = http ? { status: statusForHttp(http.status), error: `HTTP ${http.status}` } : classifyNetworkError(err);
          return { ...out, ...c, latencyMs: out.latencyMs ?? Date.now() - started };
        }
      }
    }
  }

  if (read) {
    const snapshot = buildSnapshot(read);
    return {
      ...out,
      status: 'open',
      transport,
      protocolMode: mode,
      protocolVersion: read.protocolVersion,
      serverName: read.serverName,
      serverVersion: read.serverVersion,
      snapshot,
      auth: { ...out.auth, mode: 'none' },
      latencyMs: out.latencyMs ?? Date.now() - started,
    };
  }

  if (challenge) {
    // The SDK path does not surface the header; re-ask once, cheaply, for it.
    let wwwAuthenticate = challenge.wwwAuthenticate;
    if (wwwAuthenticate === null) {
      try {
        const res = await opts.fetch(identity.url, {
          method: 'POST',
          signal: budget,
          headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: CLIENT_INFO } }),
        });
        wwwAuthenticate = res.headers.get('www-authenticate');
        await res.body?.cancel().catch(() => {});
      } catch {
        /* discovery still has the well-known paths */
      }
    }
    const discovery = await discoverOAuth(opts.fetch, new URL(identity.url), parseWwwAuthenticate(wwwAuthenticate), budget);
    return {
      ...out,
      status: 'auth_required',
      transport: 'streamable-http',
      auth: {
        mode: discovery.oauth ? 'oauth' : 'static',
        challengeStatus: challenge.status,
        oauth: discovery.oauth,
        declaredHeaders: declared,
      },
      violations: discovery.violations,
      latencyMs: out.latencyMs ?? Date.now() - started,
    };
  }

  return { ...out, status: 'protocol_error', error: 'answered, but not as an MCP server', latencyMs: out.latencyMs ?? Date.now() - started };
}
