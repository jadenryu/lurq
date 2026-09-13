/**
 * The scan routes on a real express app, with the auth guards replaced by
 * header-driven fakes and the storage layer mocked. What is under test is the
 * HTTP contract: who may call what, which bodies are refused, and that a large
 * but legitimate upload gets past the body parser.
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/usage', () => ({ recordUsage: vi.fn(async () => {}) }));
vi.mock('../src/db/mcpScans', () => ({
  listDeployments: vi.fn(async () => [{ id: 1, alias: 'calc' }]),
  listChangeEvents: vi.fn(async () => []),
  getDeploymentDetail: vi.fn(async (_db: unknown, _owner: string, id: number) => (id === 1 ? { deployment: { id } } : null)),
  acknowledgeEvent: vi.fn(async (_db: unknown, _owner: string, id: number) => id === 7),
}));
vi.mock('../src/mcpScan/ingest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/mcpScan/ingest')>();
  return { ...actual, ingestScan: vi.fn(async () => ({ servers: [], rejected: [] })) };
});

import { MCP_SCAN_BODY_LIMIT, MCP_SCAN_UPLOAD_PATH, registerMcpScanRoutes } from '../src/mcp/mcpScanRoutes';
import * as ingest from '../src/mcpScan/ingest';

const pass = (_req: Request, _res: Response, next: NextFunction) => next();

let server: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  // The production global parser, including its skip for the upload path.
  const jsonBody = express.json({ limit: '1mb' });
  app.use((req, res, next) => (req.path === MCP_SCAN_UPLOAD_PATH ? next() : jsonBody(req, res, next)));
  registerMcpScanRoutes(app, {
    db: {} as never,
    ipLimiter: pass,
    keyLimiter: pass,
    quota: pass,
    auth: (req, _res, next) => {
      (req as Request & { lurqKey?: { ownerId: string | null } }).lurqKey = { ownerId: (req.headers['x-owner'] as string) || null };
      next();
    },
    bigJson: express.json({ limit: MCP_SCAN_BODY_LIMIT }),
    requireIssuerSecret: (req, res, next) => (req.headers['x-issuer'] === 'ok' ? next() : void res.status(401).end()),
    ownerFrom: (req) => String((req.method === 'GET' ? req.query.ownerId : req.body?.ownerId) ?? '').trim(),
    keyOwner: (req, res) => {
      const ownerId = (req as Request & { lurqKey?: { ownerId: string | null } }).lurqKey?.ownerId ?? null;
      if (!ownerId) res.status(403).json({ error: 'This key has no account attached.' });
      return ownerId;
    },
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => vi.mocked(ingest.ingestScan).mockClear());

const tool = (i: number) => ({ name: `tool_${i}`, description: 'x'.repeat(1500), inputSchema: { type: 'object' } });

const serverPayload = (tools: unknown[] = [tool(0)]) => ({
  alias: 'calc',
  serverKey: 'local:calc',
  configFingerprint: '0123456789abcdef',
  registry: 'local',
  packageName: null,
  pinnedVersion: null,
  transport: 'stdio',
  status: 'ok',
  error: null,
  snapshot: { serverInfo: { name: 'calc', version: '1' }, instructions: null, tools, prompts: [], resourceTemplates: [] },
});

const upload = (body: unknown, owner = 'user_1') =>
  fetch(`${base}${MCP_SCAN_UPLOAD_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(owner ? { 'x-owner': owner } : {}) },
    body: JSON.stringify(body),
  });

describe('POST /mcp-scans', () => {
  it('refuses a key with no account', async () => {
    const res = await upload({ servers: [serverPayload()] }, '');
    expect(res.status).toBe(403);
    expect(ingest.ingestScan).not.toHaveBeenCalled();
  });

  it('refuses a malformed body', async () => {
    expect((await upload({ servers: 'no' })).status).toBe(400);
  });

  it('refuses an upload where every server was rejected, and says why', async () => {
    const res = await upload({ servers: [{ ...serverPayload(), configFingerprint: 'nope' }] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { rejected: unknown[] }).rejected).toHaveLength(1);
  });

  it('records a valid upload under the key owner', async () => {
    const res = await upload({ source: 'ci', servers: [serverPayload()] });
    expect(res.status).toBe(200);
    const [, ownerId, parsed] = vi.mocked(ingest.ingestScan).mock.calls[0]!;
    expect(ownerId).toBe('user_1');
    expect(parsed.source).toBe('ci');
    expect(parsed.servers[0]!.contract!.tools).toHaveLength(1);
  });

  // The global 1mb parser would 413 this; a real server with many tools sends it.
  it('accepts a multi-megabyte upload that the global limit would refuse', async () => {
    const body = { servers: [serverPayload(Array.from({ length: 1500 }, (_, i) => tool(i)))] };
    expect(JSON.stringify(body).length).toBeGreaterThan(2_000_000);
    const res = await upload(body);
    expect(res.status).toBe(200);
  });
});

describe('dashboard routes', () => {
  const get = (path: string, issuer = 'ok') => fetch(`${base}${path}`, { headers: { 'x-issuer': issuer } });

  it('require the issuer secret and an ownerId', async () => {
    expect((await get('/mcp-servers?ownerId=user_1', 'bad')).status).toBe(401);
    expect((await get('/mcp-servers')).status).toBe(400);
    const ok = await get('/mcp-servers?ownerId=user_1');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ servers: [{ id: 1, alias: 'calc' }], events: [] });
  });

  it('reads one server, 404 when it is not this account’s', async () => {
    expect((await get('/mcp-servers/abc?ownerId=user_1')).status).toBe(400);
    expect((await get('/mcp-servers/2?ownerId=user_1')).status).toBe(404);
    expect((await get('/mcp-servers/1?ownerId=user_1')).status).toBe(200);
  });

  it('acknowledges a change, 404 for someone else’s', async () => {
    const ack = (id: number) =>
      fetch(`${base}/mcp-servers/events/${id}/acknowledge`, {
        method: 'POST',
        headers: { 'x-issuer': 'ok', 'content-type': 'application/json' },
        body: JSON.stringify({ ownerId: 'user_1' }),
      });
    expect((await ack(7)).status).toBe(200);
    expect((await ack(8)).status).toBe(404);
  });
});
