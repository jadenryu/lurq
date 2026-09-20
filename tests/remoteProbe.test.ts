/**
 * The probe against real HTTP: a stateless 2026-07-28 server, an SDK server that
 * needs the initialize handshake, OAuth-protected and key-only servers, and dead
 * routes. Only the SSRF policy is relaxed, and only for this one local origin.
 */
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createSafeFetch, publicHttpsOnly, type UrlPolicy } from '../src/core/safeFetch';
import { classifyNetworkError, probeEndpoint } from '../src/remoteProbe/probe';

let server: Server;
let base: string;
const sessions = new Map<string, StreamableHTTPServerTransport>();

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => resolve(b));
  });
}

const json = (
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  res
    .writeHead(status, { 'content-type': 'application/json', ...headers })
    .end(JSON.stringify(body));

const TOOL = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  description: `${name} tool`,
  inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
  annotations: { readOnlyHint: true },
  ...extra,
});

async function legacyMcp(req: IncomingMessage, res: ServerResponse, body: string) {
  const sid = req.headers['mcp-session-id'];
  let transport = typeof sid === 'string' ? sessions.get(sid) : undefined;
  if (!transport) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, transport!);
      },
    });
    const mcp = new McpServer({ name: 'legacy-fixture', version: '9.9.9' });
    mcp.registerTool(
      'echo',
      { description: 'Echo text back', inputSchema: { text: z.string() } },
      async ({ text }) => ({
        content: [{ type: 'text', text }],
      }),
    );
    await mcp.connect(transport);
  }
  await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const body = await readBody(req);
    const url = req.url ?? '';
    const rpc = body ? (JSON.parse(body) as { id?: number; params?: { cursor?: string } }) : {};
    switch (true) {
      case url === '/stateless': {
        const page2 = rpc.params?.cursor === 'p2';
        return json(res, 200, {
          jsonrpc: '2.0',
          id: rpc.id,
          result: {
            resultType: 'complete',
            tools: page2 ? [TOOL('second')] : [TOOL('first'), { description: 'no name' }],
            ...(page2 ? {} : { nextCursor: 'p2' }),
            _meta: {
              'io.modelcontextprotocol/serverInfo': { name: 'stateless-fixture', version: '2.0.0' },
            },
          },
        });
      }
      case url === '/sse-reply':
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        return res.end(
          `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { tools: [TOOL('streamed')] } })}\n\n`,
        );
      case url === '/legacy':
        return legacyMcp(req, res, body);
      case url === '/secure':
        return json(
          res,
          401,
          { error: 'unauthorized' },
          {
            'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/secure", scope="read"`,
          },
        );
      case url === '/.well-known/oauth-protected-resource/secure':
        return json(res, 200, {
          resource: `${base}/secure`,
          authorization_servers: [`${base}/as`],
        });
      case url === '/.well-known/oauth-authorization-server/as':
        return json(res, 200, {
          issuer: `${base}/as`,
          registration_endpoint: `${base}/as/register`,
          client_id_metadata_document_supported: true,
          code_challenge_methods_supported: ['S256'],
        });
      case url === '/keyonly':
        return json(res, 401, { error: 'missing api key' });
      case url === '/broken':
        return json(res, 500, { error: 'boom' });
      default:
        return json(res, 404, { error: 'not found' });
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const t of sessions.values()) await t.close().catch(() => {});
  await new Promise<void>((r) => server.close(() => r()));
});

const onlyTestServer: UrlPolicy = (url) => {
  if (url.origin === base) return;
  publicHttpsOnly(url);
};
const localLookup = ((_h: string, o: { all?: boolean }, cb: (...a: unknown[]) => void) =>
  o?.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4)) as never;
const fetch = () => createSafeFetch({ policy: onlyTestServer, lookup: localLookup });
const probe = (path: string) =>
  probeEndpoint(`${base}${path}`, { fetch: fetch(), budgetMs: 15_000, requestTimeoutMs: 5_000 });

describe('probeEndpoint', () => {
  it('reads a stateless server across pages, keeping good tools and skipping malformed ones', async () => {
    const r = await probe('/stateless');
    expect(r).toMatchObject({
      status: 'open',
      protocolMode: 'stateless',
      transport: 'streamable-http',
      serverName: 'stateless-fixture',
      serverVersion: '2.0.0',
      auth: { mode: 'none' },
      httpStatus: 200,
    });
    expect(r.snapshot!.tools.map((t) => t.name)).toEqual(['first', 'second']);
    expect(r.snapshot!.issues).toEqual([expect.objectContaining({ kind: 'malformed' })]);
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('reads a JSON-RPC reply delivered as an SSE stream', async () => {
    const r = await probe('/sse-reply');
    expect(r.status).toBe('open');
    expect(r.snapshot!.tools.map((t) => t.name)).toEqual(['streamed']);
  });

  it('falls back to the initialize handshake for a session-based server', async () => {
    const r = await probe('/legacy');
    expect(r).toMatchObject({
      status: 'open',
      protocolMode: 'initialize',
      transport: 'streamable-http',
      serverName: 'legacy-fixture',
      serverVersion: '9.9.9',
    });
    expect(r.snapshot!.tools.map((t) => t.name)).toEqual(['echo']);
  });

  it('follows OAuth discovery for a protected server, with no violations when compliant', async () => {
    const r = await probe('/secure');
    expect(r).toMatchObject({ status: 'auth_required', httpStatus: 401, snapshot: null });
    expect(r.auth).toMatchObject({ mode: 'oauth', challengeStatus: 401 });
    expect(r.auth.oauth).toMatchObject({
      issuer: `${base}/as`,
      cimd: true,
      dcr: true,
      pkceS256: true,
      challengeScope: 'read',
    });
    expect(r.violations).toEqual([]);
  });

  it('calls a refused server with no OAuth discovery a static-key server', async () => {
    const r = await probe('/keyonly');
    expect(r.status).toBe('auth_required');
    expect(r.auth.mode).toBe('static');
    expect(r.violations.map((v) => v.code)).toEqual(['challenge_without_resource_metadata']);
  });

  it('reports dead and failing routes by status, never with the body', async () => {
    const gone = await probe('/nowhere');
    expect(gone.status).toBe('not_found');
    const broken = await probe('/broken');
    expect(broken).toMatchObject({ status: 'server_error', error: 'HTTP 500' });
    expect(JSON.stringify(broken)).not.toContain('boom');
  });

  it('refuses what policy forbids, and names templated URLs without connecting', async () => {
    const strict = await probeEndpoint(`${base}/stateless`, {
      fetch: createSafeFetch(),
      budgetMs: 5_000,
    });
    expect(strict.status).toBe('blocked');
    const templated = await probeEndpoint('https://{tenant}.example.com/mcp', { fetch: fetch() });
    expect(templated.status).toBe('templated');
    expect((await probeEndpoint('ftp://x.dev/', { fetch: fetch() })).status).toBe('blocked');
  });
});

describe('classifyNetworkError', () => {
  it('maps transport failures to statuses in our own words', () => {
    expect(classifyNetworkError(Object.assign(new Error('x'), { code: 'ENOTFOUND' })).status).toBe(
      'dns_failed',
    );
    expect(
      classifyNetworkError(
        Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }),
      ),
    ).toEqual({
      status: 'unreachable',
      error: 'connection failed (ECONNREFUSED)',
    });
    expect(
      classifyNetworkError(Object.assign(new Error('x'), { name: 'TimeoutError' })).status,
    ).toBe('timeout');
    expect(
      classifyNetworkError(Object.assign(new Error('x'), { cause: { code: 'EPRIVATE' } })).status,
    ).toBe('blocked');
    expect(
      classifyNetworkError(Object.assign(new Error('x'), { cause: { code: 'CERT_HAS_EXPIRED' } }))
        .status,
    ).toBe('unreachable');
  });
});
