/**
 * Email settings and unsubscribe routes on a real express app, storage mocked.
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/notifications', () => ({
  getOrCreatePreferences: vi.fn(async () => ({ urgentEmail: true, weeklyDigest: false })),
  setPreferences: vi.fn(async (_db: unknown, _o: string, patch: Record<string, boolean>) => ({ urgentEmail: true, weeklyDigest: false, ...patch })),
  unsubscribeByToken: vi.fn(async (_db: unknown, token: string) => token === 'a'.repeat(43)),
}));
vi.mock('../src/notify/run', () => ({ emailConfigured: () => false }));

import { registerNotificationRoutes } from '../src/mcp/notificationRoutes';
import * as store from '../src/db/notifications';

let server: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerNotificationRoutes(app, {
    db: {} as never,
    requireIssuerSecret: (req: Request, res: Response, next: NextFunction) => (req.headers['x-issuer'] === 'ok' ? next() : void res.status(401).end()),
    ownerFrom: (req) => String((req.method === 'GET' ? req.query.ownerId : req.body?.ownerId) ?? '').trim(),
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const call = (method: string, path: string, body?: unknown, issuer = 'ok') =>
  fetch(`${base}${path}`, { method, headers: { 'x-issuer': issuer, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

describe('notification preferences', () => {
  it('reads the defaults, and whether email is configured at all', async () => {
    expect((await call('GET', '/notification-preferences?ownerId=user_1', undefined, 'bad')).status).toBe(401);
    expect((await call('GET', '/notification-preferences')).status).toBe(400);
    const res = await call('GET', '/notification-preferences?ownerId=user_1');
    expect(await res.json()).toEqual({ urgentEmail: true, weeklyDigest: false, emailConfigured: false });
  });

  it('writes only booleans it knows', async () => {
    expect((await call('PUT', '/notification-preferences', { ownerId: 'user_1', weeklyDigest: 'yes' })).status).toBe(400);
    expect((await call('PUT', '/notification-preferences', { ownerId: 'user_1', admin: true })).status).toBe(400);
    const ok = await call('PUT', '/notification-preferences', { ownerId: 'user_1', weeklyDigest: true, admin: true });
    expect(ok.status).toBe(200);
    expect(vi.mocked(store.setPreferences).mock.calls.at(-1)![2]).toEqual({ weeklyDigest: true });
  });
});

describe('unsubscribe', () => {
  it('answers the same for a matching and an unknown token', async () => {
    const known = await call('POST', '/notifications/unsubscribe', { token: 'a'.repeat(43), kind: 'urgent' });
    const unknown = await call('POST', '/notifications/unsubscribe', { token: 'b'.repeat(43), kind: 'urgent' });
    expect([known.status, unknown.status]).toEqual([200, 200]);
    expect(await known.json()).toEqual(await unknown.json());
  });

  it('refuses a malformed token or kind', async () => {
    expect((await call('POST', '/notifications/unsubscribe', { token: 'short', kind: 'urgent' })).status).toBe(400);
    expect((await call('POST', '/notifications/unsubscribe', { token: 'a'.repeat(43), kind: 'everything' })).status).toBe(400);
  });
});
