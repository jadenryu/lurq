/**
 * Alert channel routes on a real express app, storage mocked, posting faked.
 */
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const rows: Record<string, unknown>[] = [];
vi.mock('../src/db/notifications', () => ({
  listChannels: vi.fn(async (_db: unknown, ownerId: string) =>
    rows.filter((r) => r.ownerId === ownerId),
  ),
  getChannel: vi.fn(
    async (_db: unknown, ownerId: string, id: number) =>
      rows.find((r) => r.ownerId === ownerId && r.id === id) ?? null,
  ),
  insertChannel: vi.fn(async (_db: unknown, row: Record<string, unknown>) => {
    const created = {
      id: rows.length + 1,
      enabled: true,
      disabledReason: null,
      lastError: null,
      createdAt: new Date(),
      ...row,
    };
    rows.push(created);
    return created;
  }),
  updateChannel: vi.fn(
    async (_db: unknown, ownerId: string, id: number, patch: Record<string, unknown>) => {
      const row = rows.find((r) => r.ownerId === ownerId && r.id === id);
      return row ? Object.assign(row, patch) : null;
    },
  ),
  removeChannel: vi.fn(async (_db: unknown, ownerId: string, id: number) =>
    rows.some((r) => r.ownerId === ownerId && r.id === id),
  ),
}));

import { registerChannelRoutes } from '../src/mcp/channelRoutes';
import { open } from '../src/core/secretBox';

const key = randomBytes(32);
const post = vi.fn(async () => ({ status: 200, error: null as string | null }));
let allowed = true;
let server: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerChannelRoutes(app, {
    db: {} as never,
    requireIssuerSecret: (_req: Request, _res: Response, next: NextFunction) => next(),
    ownerFrom: (req) =>
      String((req.method === 'GET' ? req.query.ownerId : req.body?.ownerId) ?? '').trim(),
    secretsKey: key,
    webUrl: 'https://lurq.test',
    allowed: async () => allowed,
    post,
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  post.mockClear();
  post.mockResolvedValue({ status: 200, error: null });
  allowed = true;
});

const call = (method: string, path: string, body?: unknown) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

describe('adding a channel', () => {
  it('tests the URL, stores it encrypted, and shows the signing secret once', async () => {
    const res = await call('POST', '/notification-channels', {
      ownerId: 'user_1',
      kind: 'webhook',
      url: 'https://example.com/hook',
      minSeverity: 'moderate',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { channel: Record<string, unknown>; signingSecret: string };
    expect(post).toHaveBeenCalledTimes(1);
    expect(body.signingSecret).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(body.channel).toMatchObject({
      kind: 'webhook',
      minSeverity: 'moderate',
      urlHint: 'example.com/…hook',
    });
    expect(JSON.stringify(body.channel)).not.toContain('example.com/hook');
    const stored = rows.at(-1)!;
    expect(open(stored.urlCiphertext as string, key, 'user_1')).toBe('https://example.com/hook');

    const list = (await (await call('GET', '/notification-channels?ownerId=user_1')).json()) as {
      channels: unknown[];
      allowed: boolean;
    };
    expect(list.allowed).toBe(true);
    expect(JSON.stringify(list)).not.toContain('signing');
  });

  it('stores nothing when the test post fails', async () => {
    post.mockResolvedValueOnce({ status: 404, error: 'HTTP 404: no_service' });
    const before = rows.length;
    const res = await call('POST', '/notification-channels', {
      ownerId: 'user_1',
      kind: 'slack',
      url: 'https://hooks.slack.com/services/T/B/x',
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/could not post/);
    expect(rows.length).toBe(before);
  });

  it('refuses a bad URL without posting, and a plan without channels', async () => {
    expect(
      (
        await call('POST', '/notification-channels', {
          ownerId: 'user_1',
          kind: 'slack',
          url: 'https://example.com/x',
        })
      ).status,
    ).toBe(400);
    expect(post).not.toHaveBeenCalled();
    allowed = false;
    const res = await call('POST', '/notification-channels', {
      ownerId: 'user_1',
      kind: 'discord',
      url: 'https://discord.com/api/webhooks/1/x',
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toMatch(/Team plan/);
  });
});

describe('managing a channel', () => {
  it('re-enabling clears the switched-off state', async () => {
    const row = rows[0]!;
    Object.assign(row, { enabled: false, disabledReason: 'gone', consecutiveFailures: 9 });
    const res = await call('PATCH', `/notification-channels/${row.id}`, {
      ownerId: 'user_1',
      enabled: true,
    });
    expect(res.status).toBe(200);
    expect(row).toMatchObject({ enabled: true, disabledReason: null, consecutiveFailures: 0 });
  });

  it('is owner-scoped', async () => {
    expect(
      (await call('PATCH', '/notification-channels/1', { ownerId: 'user_2', enabled: false }))
        .status,
    ).toBe(404);
    expect((await call('DELETE', '/notification-channels/1', { ownerId: 'user_2' })).status).toBe(
      404,
    );
    expect(
      (await call('POST', '/notification-channels/1/test', { ownerId: 'user_2' })).status,
    ).toBe(404);
  });

  it('sends a test on request and reports the result', async () => {
    post.mockResolvedValueOnce({ status: 429, error: 'HTTP 429' });
    const res = await call('POST', '/notification-channels/1/test', { ownerId: 'user_1' });
    expect(await res.json()).toEqual({ ok: false, error: 'HTTP 429' });
  });
});
