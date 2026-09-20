/**
 * Saved builder scan routes on a real express app, storage mocked.
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const rows = new Map<string, { profile: Record<string, unknown>; scannedAt: Date }>();
/** Twenty other builders with 0..19 repos, plus the subject's own earlier save, which must not count. */
const population = [
  ...Array.from({ length: 20 }, (_, i) => ({
    login: `b${i}`,
    repos: i,
    active90: 0,
    stars: 0,
    depsTracked: 0,
    depsBehind: 0,
    depsMajor: 0,
    advisories: 0,
  })),
  {
    login: 'ada',
    repos: 999,
    active90: 0,
    stars: 0,
    depsTracked: 0,
    depsBehind: 0,
    depsMajor: 0,
    advisories: 0,
  },
];

vi.mock('../src/db/builderScans', () => ({
  saveBuilderScan: vi.fn(
    async (_db: unknown, ownerId: string, target: string, profile: Record<string, unknown>) => {
      const scannedAt = new Date();
      rows.set(`${ownerId}|${target}`, { profile, scannedAt });
      return scannedAt;
    },
  ),
  getBuilderScan: vi.fn(async (_db: unknown, ownerId: string, target: string) => {
    const row = rows.get(`${ownerId}|${target}`);
    return row
      ? {
          ...row,
          metrics: {
            repos: 3,
            active90: 2,
            stars: 10,
            depsTracked: 0,
            depsBehind: 0,
            depsMajor: 0,
            advisories: 0,
          },
        }
      : null;
  }),
  listBuilderScans: vi.fn(async (_db: unknown, ownerId: string) =>
    [...rows]
      .filter(([k]) => k.startsWith(`${ownerId}|`))
      .map(([k, v]) => ({ target: k.split('|')[1], login: v.profile.login })),
  ),
  builderPopulation: vi.fn(async () => population),
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
    ownerFrom: (req) =>
      String((req.method === 'GET' ? req.query.ownerId : req.body?.ownerId) ?? '').trim(),
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const call = (method: string, path: string, body?: unknown) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

const profile = {
  login: 'Ada',
  url: 'https://github.com/Ada',
  avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
  archetype: 'shipper',
  traits: [{ id: 'shipper', score: 90, evidence: [] }],
  stats: { repos: 3, active90: 2, stars: 10, languages: [] },
  repos: [],
};

type Standing = { population: number; metrics: { id: string; percentile: number }[] };

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
    const saved = await call('PUT', '/builder-scans', {
      ownerId: 'user_1',
      target: 'github.com/ADA',
      profile,
    });
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as { target: string }).target).toBe('ada');

    const one = await call('GET', '/builder-scans/one?ownerId=user_1&target=ada');
    expect(one.status).toBe(200);
    expect(
      ((await one.json()) as { scan: { profile: { login: string } } }).scan.profile.login,
    ).toBe('Ada');

    expect((await call('GET', '/builder-scans/one?ownerId=user_2&target=ada')).status).toBe(404);
    const list = (await (await call('GET', '/builder-scans?ownerId=user_2')).json()) as {
      scans: unknown[];
    };
    expect(list.scans).toEqual([]);
  });

  it('answers a save and a reopen with the same standing, never counting the builder against themselves', async () => {
    const saved = (await (
      await call('PUT', '/builder-scans', { ownerId: 'user_1', target: 'ada', profile })
    ).json()) as { standing: Standing };
    const one = (await (
      await call('GET', '/builder-scans/one?ownerId=user_1&target=ada')
    ).json()) as { scan: { standing: Standing } };

    // 3 repos is above 0,1,2 and tied with 3 among twenty others: (3 + 0.5) / 20.
    expect(saved.standing.population).toBe(20);
    expect(saved.standing.metrics.find((x) => x.id === 'repos')?.percentile).toBe(18);
    // No tracked stack, so no dependency metrics to rank.
    expect(saved.standing.metrics.some((x) => x.id === 'behindShare')).toBe(false);
    expect(one.scan.standing).toEqual(saved.standing);
  });

  it('refuses a missing owner, a bad target and a malformed profile', async () => {
    expect((await call('PUT', '/builder-scans', { target: 'ada', profile })).status).toBe(400);
    expect(
      (await call('PUT', '/builder-scans', { ownerId: 'user_1', target: '!!', profile })).status,
    ).toBe(400);
    expect(
      (
        await call('PUT', '/builder-scans', {
          ownerId: 'user_1',
          target: 'ada',
          profile: { ...profile, archetype: 'wizard' },
        })
      ).status,
    ).toBe(400);
    expect((await call('GET', '/builder-scans')).status).toBe(400);
  });

  it('refuses a profile past the size cap', async () => {
    const huge = { ...profile, repos: [{ blob: 'x'.repeat(600_000) }] };
    expect(
      (await call('PUT', '/builder-scans', { ownerId: 'user_1', target: 'ada', profile: huge }))
        .status,
    ).toBe(413);
  });
});
