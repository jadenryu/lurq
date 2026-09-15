/**
 * Public MCP routes on a real express app, storage and resolution mocked, guards
 * faked: the API-key routes read the owner from a header, the issuer routes from
 * the body or query, exactly as the real guards hand them over.
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const pins = new Map<string, { endpointId: number; note: string | null; removed: boolean }>();
const acks: [string, number][] = [];
const ENDPOINT = {
  id: 7,
  url: 'https://mcp.acme.dev/mcp',
  host: 'mcp.acme.dev',
  transport: 'streamable-http',
  lastStatus: 'auth_required',
  lastHttpStatus: 401,
  lastContentHash: null,
  auth: { mode: 'oauth' },
  violations: [],
  protocolMode: null,
  protocolVersion: null,
  serverName: null,
  serverVersion: null,
  latencyMs: 80,
  lastError: null,
  firstSeenAt: new Date('2026-09-01T00:00:00Z'),
  lastProbedAt: new Date('2026-09-15T00:00:00Z'),
  lastChangedAt: null,
  removedAt: null,
};
const pinStatus = (ownerId: string) => {
  const p = pins.get(`${ownerId}:7`);
  if (!p || p.removed) return null;
  return {
    pin: { id: 1, ownerId, endpointId: 7, contentHash: null, authHash: 'a', note: p.note, pinnedAt: new Date('2026-09-15T01:00:00Z'), removedAt: null },
    endpoint: { id: 7, url: ENDPOINT.url, lastStatus: 'auth_required', lastProbedAt: ENDPOINT.lastProbedAt, lastContentHash: null, lastAuthHash: 'a' },
    contractChanged: false,
    authChanged: false,
    openChanges: 0,
    worstOpen: null,
  };
};

vi.mock('../src/connect/check', () => ({
  resolveServerEndpoint: vi.fn(async (_db: unknown, q: string) => (q === ENDPOINT.url || q === 'io.acme/tools' ? ENDPOINT : null)),
  handleConnectCheck: vi.fn(async () => ({
    clients: [{ client: 'chatgpt', clientName: 'ChatGPT', verdict: 'blocked', blockers: [{ code: 'x', detail: 'no shared registration' }], setup: [], warnings: [], unknowns: [] }],
    summary: { works: 0, needs_setup: 0, blocked: 1, unknown: 0 },
  })),
}));
vi.mock('../src/db/publicMcpAlerts', () => ({
  listPins: vi.fn(async (_db: unknown, ownerId: string) => [pinStatus(ownerId)].filter(Boolean)),
  getPin: vi.fn(async (_db: unknown, ownerId: string) => pinStatus(ownerId)),
  pinEndpoint: vi.fn(async (_db: unknown, ownerId: string, endpointId: number, note: string | null = null) => {
    if (endpointId !== 7) return null;
    pins.set(`${ownerId}:7`, { endpointId, note, removed: false });
    return { id: 1 };
  }),
  unpinEndpoint: vi.fn(async (_db: unknown, ownerId: string) => {
    const p = pins.get(`${ownerId}:7`);
    if (!p || p.removed) return false;
    p.removed = true;
    return true;
  }),
  publicChangeExists: vi.fn(async (_db: unknown, id: number) => id === 42),
  acknowledgePublicChange: vi.fn(async (_db: unknown, ownerId: string, id: number) => void acks.push([ownerId, id])),
  acknowledgedChangeIds: vi.fn(async () => new Set([42])),
}));
vi.mock('../src/db/remoteEndpoints', () => ({
  getEndpointById: vi.fn(async (_db: unknown, id: number) => (id === 7 ? ENDPOINT : null)),
  listServerNamesForEndpoint: vi.fn(async () => ['io.acme/tools']),
  listEndpointObservations: vi.fn(async () => []),
  listEndpointChanges: vi.fn(async () => [{ id: 42, kind: 'auth', severity: 'high', summary: 'DCR no longer offered', createdAt: new Date() }, { id: 43, kind: 'status', severity: 'low', summary: 'answering again', createdAt: new Date() }]),
}));
vi.mock('../src/db/mcpScans', () => ({ getContract: vi.fn(async () => null) }));
vi.mock('../src/db/usage', () => ({ recordUsage: vi.fn(async () => {}) }));
vi.mock('../src/core/analytics', () => ({ capture: vi.fn() }));

import { registerPublicMcpRoutes } from '../src/mcp/publicMcpRoutes';

let server: Server;
let base = '';
const pass = (_req: Request, _res: Response, next: NextFunction) => next();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerPublicMcpRoutes(app, {
    db: {} as never,
    ipLimiter: pass,
    auth: pass,
    keyLimiter: pass,
    requireIssuerSecret: pass,
    ownerFrom: (req) => String((req.method === 'GET' ? req.query.ownerId : req.body?.ownerId) ?? '').trim(),
    keyOwner: (req, res) => {
      const owner = req.header('x-test-owner') ?? null;
      if (!owner) res.status(403).json({ error: 'This key has no account attached.' });
      return owner;
    },
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  pins.clear();
  acks.length = 0;
});

const call = (method: string, path: string, body?: unknown, owner: string | null = 'user_1') =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(owner ? { 'x-test-owner': owner } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

describe('pins over the API key', () => {
  it('pins by URL or registry name, lists, and unpins', async () => {
    const pinned = await call('POST', '/mcp-pins', { server: 'io.acme/tools', note: 'reviewed' });
    expect(pinned.status).toBe(200);
    expect(((await pinned.json()) as { pin: Record<string, unknown> }).pin).toMatchObject({ endpointId: 7, url: ENDPOINT.url, note: 'reviewed', contractChanged: false });

    const list = (await (await call('GET', '/mcp-pins')).json()) as { pins: unknown[] };
    expect(list.pins).toHaveLength(1);

    expect(await (await call('POST', '/mcp-pins/unpin', { server: ENDPOINT.url })).json()).toEqual({ unpinned: true });
    expect(await (await call('POST', '/mcp-pins/unpin', { server: ENDPOINT.url })).json()).toEqual({ unpinned: false });
  });

  it('refuses a missing body, an unprobed server, and a key with no account', async () => {
    expect((await call('POST', '/mcp-pins', {})).status).toBe(400);
    const missing = await call('POST', '/mcp-pins', { server: 'io.nobody/nothing' });
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: string }).error).toMatch(/connect_check/);
    expect((await call('GET', '/mcp-pins', undefined, null)).status).toBe(403);
  });

  it('acknowledges an existing public change and 404s an unknown one', async () => {
    expect((await call('POST', '/mcp-public-changes/42/acknowledge', {})).status).toBe(200);
    expect(acks).toEqual([['user_1', 42]]);
    expect((await call('POST', '/mcp-public-changes/999/acknowledge', {})).status).toBe(404);
    expect((await call('POST', '/mcp-public-changes/abc/acknowledge', {})).status).toBe(400);
  });
});

describe('dashboard routes', () => {
  it('returns an endpoint with its changes marked acknowledged per account, its pin, and client verdicts', async () => {
    await call('POST', '/mcp-public/7/pin', { ownerId: 'user_2' }, null);
    const res = await fetch(`${base}/mcp-public/7?ownerId=user_2`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown> & { changes: { id: number; acknowledged: boolean }[]; clients: unknown[] };
    expect(body).toMatchObject({ endpoint: { id: 7, url: ENDPOINT.url, status: 'auth_required' }, servers: ['io.acme/tools'], contract: null, pin: { endpointId: 7 }, summary: { blocked: 1 } });
    expect(body.changes.map((c) => [c.id, c.acknowledged])).toEqual([
      [42, true],
      [43, false],
    ]);
    expect(body.clients).toEqual([{ client: 'chatgpt', clientName: 'ChatGPT', verdict: 'blocked', reason: 'no shared registration' }]);
  });

  it('requires an owner and a real endpoint', async () => {
    expect((await fetch(`${base}/mcp-public/7`)).status).toBe(400);
    expect((await fetch(`${base}/mcp-public/8?ownerId=user_2`)).status).toBe(404);
    expect((await call('POST', '/mcp-public/8/pin', { ownerId: 'user_2' }, null)).status).toBe(404);
  });

  it('acknowledges and unpins for the dashboard owner', async () => {
    expect((await call('POST', '/mcp-public/changes/42/acknowledge', { ownerId: 'user_3' }, null)).status).toBe(200);
    expect(acks).toEqual([['user_3', 42]]);
    await call('POST', '/mcp-public/7/pin', { ownerId: 'user_3' }, null);
    expect(await (await call('POST', '/mcp-public/7/unpin', { ownerId: 'user_3' }, null)).json()).toEqual({ unpinned: true });
  });
});
