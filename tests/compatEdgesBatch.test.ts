import { describe, expect, it, vi } from 'vitest';
import { chunk, EDGE_UPSERT_CHUNK, upsertCompatEdgesBatch } from '../src/db/compat';
import type { Database } from '../src/db/client';
import type { NewCompatEdgeRow } from '../src/db/schema';

describe('chunk / EDGE_UPSERT_CHUNK (sync OOM guard)', () => {
  it('splits into consecutive slices of at most size', () => {
    const parts = chunk(Array.from({ length: 501 }, (_, i) => i), EDGE_UPSERT_CHUNK);
    expect(parts).toHaveLength(Math.ceil(501 / EDGE_UPSERT_CHUNK));
    expect(parts[0]).toHaveLength(EDGE_UPSERT_CHUNK);
    expect(parts[1]).toHaveLength(EDGE_UPSERT_CHUNK);
    expect(parts[2]).toHaveLength(1);
    expect(parts.flat()).toHaveLength(501);
  });

  it('returns empty for empty input', () => {
    expect(chunk([], 250)).toEqual([]);
  });

  it('keeps a small batch as one chunk', () => {
    expect(chunk([1, 2, 3], 250)).toEqual([[1, 2, 3]]);
  });
});

function fakeEdge(i: number): NewCompatEdgeRow {
  return {
    packageA: `a-${i}`,
    versionA: '1.0.0',
    packageB: `b-${i}`,
    versionB: '1.0.0',
    status: 'compatible',
    provenance: 'observed',
    witnessCount: 1,
    driver: 'depsdev',
    ranAt: new Date('2026-01-01T00:00:00Z'),
  };
}

describe('upsertCompatEdgesBatch chunking', () => {
  it('issues ceil(n / EDGE_UPSERT_CHUNK) inserts, never one mega-statement', async () => {
    const insertCalls: unknown[][] = [];
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn((rows: unknown[]) => {
      insertCalls.push(rows);
      return { onConflictDoUpdate };
    });
    const insert = vi.fn(() => ({ values }));
    const db = { insert } as unknown as Database;

    const n = EDGE_UPSERT_CHUNK * 2 + 1; // 501 when chunk=250
    await upsertCompatEdgesBatch(
      db,
      Array.from({ length: n }, (_, i) => fakeEdge(i)),
    );

    expect(insert).toHaveBeenCalledTimes(Math.ceil(n / EDGE_UPSERT_CHUNK));
    expect(insertCalls.map((c) => c.length)).toEqual([
      EDGE_UPSERT_CHUNK,
      EDGE_UPSERT_CHUNK,
      1,
    ]);
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(3);
  });

  it('no-ops on empty batch', async () => {
    const insert = vi.fn();
    await upsertCompatEdgesBatch({ insert } as unknown as Database, []);
    expect(insert).not.toHaveBeenCalled();
  });
});
