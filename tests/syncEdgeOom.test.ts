import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EDGE_UPSERT_CHUNK } from '../src/db/compat';
import type { Database } from '../src/db/client';
import { SYNC_MINE_CONCURRENCY } from '../src/pipeline/sync';

vi.mock('../src/db/packages', () => ({
  getAllPackageNames: vi.fn(),
}));

vi.mock('../src/db/compat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/db/compat')>();
  return {
    ...actual,
    getAllClosures: vi.fn(),
  };
});

vi.mock('../src/ingestion/sources/depsDev', () => ({
  fetchResolvedGraph: vi.fn(),
}));

vi.mock('../src/core/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { getAllPackageNames } from '../src/db/packages';
import { getAllClosures } from '../src/db/compat';
import { fetchResolvedGraph } from '../src/ingestion/sources/depsDev';
import { logger } from '../src/core/logger';
import { mineEdgesForPackage, remineAllClosures, trackedPairs } from '../src/pipeline/mineEdges';

const getAllPackageNamesMock = vi.mocked(getAllPackageNames);
const getAllClosuresMock = vi.mocked(getAllClosures);
const fetchResolvedGraphMock = vi.mocked(fetchResolvedGraph);
const loggerWarn = vi.mocked(logger.warn);

function fakeDb(): { db: Database; insertCalls: number[]; insert: ReturnType<typeof vi.fn> } {
  const insertCalls: number[] = [];
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn((rows: unknown[]) => {
    insertCalls.push((rows as unknown[]).length);
    return { onConflictDoUpdate };
  });
  const insert = vi.fn(() => ({ values }));
  return { db: { insert } as unknown as Database, insertCalls, insert };
}

describe('SYNC_MINE_CONCURRENCY (Railway sync cron)', () => {
  it('serializes post-sync edge mining to avoid concurrent fat-tree OOMs', () => {
    expect(SYNC_MINE_CONCURRENCY).toBe(1);
  });
});

describe('trackedPairs — fat trees that previously OOM’d upsert', () => {
  it('C(150,2) exceeds EDGE_UPSERT_CHUNK so remine must chunk (nextui-class size)', () => {
    const names = Array.from({ length: 150 }, (_, i) => `pkg-${String(i).padStart(3, '0')}`);
    const nodes = names.map((name) => ({ name, version: '1.0.0' }));
    const pairs = trackedPairs(nodes, new Set(names));
    // C(150,2) = 11175 — same order of magnitude as the ~10.7k nextui failure.
    expect(pairs).toHaveLength((150 * 149) / 2);
    expect(pairs.length).toBeGreaterThan(EDGE_UPSERT_CHUNK * 40);
  });
});

describe('remineAllClosures → chunked upserts (Trigger 2 / daily sync)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('chunk-upserts a large tracked closure instead of one mega INSERT', async () => {
    const k = 80; // C(80,2) = 3160 → ceil(3160/250) = 13 inserts
    const names = Array.from({ length: k }, (_, i) => `t-${i}`);
    getAllPackageNamesMock.mockResolvedValue(names);
    getAllClosuresMock.mockResolvedValue([
      {
        id: 1,
        packageName: 'root-pkg',
        version: '1.0.0',
        nodes: names.map((name) => ({ name, version: '1.0.0' })),
        fetchedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);

    const { db, insertCalls, insert } = fakeDb();
    const count = await remineAllClosures(db);

    expect(count).toBe((k * (k - 1)) / 2);
    expect(insert).toHaveBeenCalledTimes(Math.ceil(count / EDGE_UPSERT_CHUNK));
    expect(Math.max(...insertCalls)).toBeLessThanOrEqual(EDGE_UPSERT_CHUNK);
    expect(insertCalls.reduce((a, b) => a + b, 0)).toBe(count);
  });
});

describe('mineEdgesForPackage failure logging (operator sync path)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs truncated message + PG cause, not the full Drizzle SQL dump', async () => {
    const cause = Object.assign(new Error('bind message has 90037 parameter formats'), {
      code: '54000',
    });
    const err = new Error('Failed query: insert into "compat_edges" ' + 'p,'.repeat(5000));
    err.cause = cause;
    fetchResolvedGraphMock.mockRejectedValue(err);

    const { db } = fakeDb();
    const n = await mineEdgesForPackage(db, '@nextui-org/react', '2.6.11', new Set(['a']));

    expect(n).toBe(0);
    expect(loggerWarn).toHaveBeenCalledTimes(1);
    const msg = String(loggerWarn.mock.calls[0]![0]);
    expect(msg).toContain('edge mining failed for @nextui-org/react@2.6.11');
    expect(msg).toContain('(cause: 54000:');
    expect(msg.length).toBeLessThan(800);
    // Full Drizzle dump was ~10k+ chars; formatted log must stay tiny.
    expect(err.message.length).toBeGreaterThan(8_000);
    expect(msg.length).toBeLessThan(err.message.length / 10);
  });

  it('swallows stack-overflow style failures without throwing', async () => {
    fetchResolvedGraphMock.mockRejectedValue(new RangeError('Maximum call stack size exceeded'));
    const { db } = fakeDb();
    await expect(mineEdgesForPackage(db, 'gatsby', '5.16.1')).resolves.toBe(0);
    expect(loggerWarn).toHaveBeenCalled();
  });
});
