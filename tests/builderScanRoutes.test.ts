/**
 * Saved builder scan routes on a real express app, storage mocked.
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const rows = new Map<string, { profile: Record<string, unknown>; scannedAt: Date }>();
vi.mock('../src/db/builderScans', () => ({
  saveBuilderScan: vi.fn(async (_db: unknown, ownerId: string, target: string, profile: Record<string, unknown>) => {
    const scannedAt = new Date();
    rows.set(`${ownerId}|${target}`, { profile, scannedAt });
    return scannedAt;
  }),
  getBuilderScan: vi.fn(async (_db: unknown, ownerId: string, target: string) => rows.get(`${ownerId}|${target}`) ?? null),
  listBuilderScans: vi.fn(async (_db: unknown, ownerId: string) =>
    [...rows].filter(([k]) => k.startsWith(`${ownerId}|`)).map(([k, v]) => ({ target: k.split('|')[1], login: v.profile.login })),
  ),
}));

import { registerBuilderScanRoutes, scanKey } from '../src/mcp/builderScanRoutes';

let server: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  registerBuilderScanRoutes(app, {
    db: {} as never,
    requireIssuerSecret: (_req: Request, _res: Response, next: NextFunction) => next(),
    ownerFrom: (req) => String((req.method === 'GET' ? req.query.ownerId : req.body?.ownerId) ?? '').trim(),
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const call = (method: string, path: string, body?: unknown) =>
  fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

const profile = {
  login: 'Ada',
  url: 'https://github.com/Ada',
  avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
  archetype: 'shipper',
  traits: [{ id: 'shipper', score: 90, evidence: [] }],
  stats: { repos: 3, active90: 2, stars: 10, languages: [] },
  repos: [],
};

describe('scanKey', () => {
  it('maps a URL, an @name and a mixed-case repo to one lowercased key', () => {
    expect(scanKey('https://github.com/Ada/')).toBe('ada');
    expect(scanKey('@ada')).toBe('ada');
    expect(scanKey('Ada/Lovelace-Engine')).toBe('ada/lovelace-engine');
    expect(scanKey('not a login!')).toBeNull();
  });
});

describe('saved builder scans', () => {
  it('saves under the normalized key and reads it back for that owner only', async () => {
    const saved = await call('PUT', '/builder-scans', { ownerId: 'user_1', target: 'github.com/ADA', profile });
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as { target: string }).target).toBe('ada');

    const one = await call('GET', '/builder-scans/one?ownerId=user_1&target=ada');
    expect(one.status).toBe(200);
    expect(((await one.json()) as { scan: { profile: { login: string } } }).scan.profile.login).toBe('Ada');

    expect((await call('GET', '/builder-scans/one?ownerId=user_2&target=ada')).status).toBe(404);
    const list = (await (await call('GET', '/builder-scans?ownerId=user_2')).json()) as { scans: unknown[] };
    expect(list.scans).toEqual([]);
  });

  it('refuses a missing owner, a bad target and a malformed profile', async () => {
    expect((await call('PUT', '/builder-scans', { target: 'ada', profile })).status).toBe(400);
    expect((await call('PUT', '/builder-scans', { ownerId: 'user_1', target: '!!', profile })).status).toBe(400);
    expect((await call('PUT', '/builder-scans', { ownerId: 'user_1', target: 'ada', profile: { ...profile, archetype: 'wizard' } })).status).toBe(400);
    expect((await call('GET', '/builder-scans')).status).toBe(400);
  });

  it('refuses a profile past the size cap', async () => {
    const huge = { ...profile, repos: [{ blob: 'x'.repeat(600_000) }] };
    expect((await call('PUT', '/builder-scans', { ownerId: 'user_1', target: 'ada', profile: huge })).status).toBe(413);
  });
});
