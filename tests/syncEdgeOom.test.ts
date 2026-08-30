import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EDGE_UPSERT_CHUNK } from '../src/db/compat';
import type { Database } from '../src/db/client';
import { SYNC_MINE_CONCURRENCY } from '../src/pipeline/sync';

vi.mock('../src/db/packages', () => ({
  getAllPackageNames: vi.fn(),
  getPackageNamesCreatedSince: vi.fn(),
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

// No stored cursor => remineAllClosures takes the full-pass branch, which is the
// one this suite is about. The incremental branch is covered separately below.
vi.mock('../src/db/watch', () => ({
  getWatchCursor: vi.fn().mockResolvedValue(null),
  setWatchCursor: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/core/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { getAllPackageNames, getPackageNamesCreatedSince } from '../src/db/packages';
import { getAllClosures } from '../src/db/compat';
import { getWatchCursor } from '../src/db/watch';
import { fetchResolvedGraph } from '../src/ingestion/sources/depsDev';
import { logger } from '../src/core/logger';
import { mineEdgesForPackage, remineAllClosures, trackedPairs } from '../src/pipeline/mineEdges';

const getAllPackageNamesMock = vi.mocked(getAllPackageNames);
const createdSinceMock = vi.mocked(getPackageNamesCreatedSince);
const getWatchCursorMock = vi.mocked(getWatchCursor);
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
    getWatchCursorMock.mockResolvedValue(null); // never run before → full pass
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

describe('remineAllClosures — incremental (§4B trigger 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWatchCursorMock.mockResolvedValue('2026-08-01T00:00:00.000Z');
  });

  const closure = (id: number, packageName: string, names: string[]) => ({
    id,
    packageName,
    version: '1.0.0',
    nodes: names.map((name) => ({ name, version: '1.0.0' })),
    fetchedAt: new Date('2026-01-01T00:00:00Z'),
  });

  it('walks only closures containing a newly-tracked name, and only pairs touching it', async () => {
    getAllPackageNamesMock.mockResolvedValue(['a', 'b', 'c', 'fresh']);
    createdSinceMock.mockResolvedValue(['fresh']);
    getAllClosuresMock.mockResolvedValue([
      closure(1, 'has-new', ['a', 'b', 'fresh']), // → a↔fresh, b↔fresh (NOT a↔b)
      closure(2, 'all-old', ['a', 'b', 'c']), // → skipped entirely
    ]);

    const { db, insertCalls } = fakeDb();
    const count = await remineAllClosures(db);

    expect(count).toBe(2);
    expect(insertCalls.reduce((x, y) => x + y, 0)).toBe(2);
  });

  it('writes nothing at all when no package became tracked since the last pass', async () => {
    getAllPackageNamesMock.mockResolvedValue(['a', 'b']);
    createdSinceMock.mockResolvedValue([]);

    const { db, insert } = fakeDb();
    expect(await remineAllClosures(db)).toBe(0);
    expect(insert).not.toHaveBeenCalled();
    // The 4.5M-candidate walk is not merely filtered — it never loads closures.
    expect(getAllClosuresMock).not.toHaveBeenCalled();
  });

  it('falls back to a full pass when the stored cursor is unparseable', async () => {
    getWatchCursorMock.mockResolvedValue('not-a-date');
    getAllPackageNamesMock.mockResolvedValue(['a', 'b']);
    getAllClosuresMock.mockResolvedValue([closure(1, 'r', ['a', 'b'])]);

    const { db } = fakeDb();
    expect(await remineAllClosures(db)).toBe(1); // a↔b, unfiltered
    expect(createdSinceMock).not.toHaveBeenCalled();
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
