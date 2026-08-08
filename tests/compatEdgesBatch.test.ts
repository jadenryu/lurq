import { describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import {
  chunk,
  EDGE_UPSERT_CHUNK,
  upsertCompatEdgesBatch,
  upsertObservedEdgesRemine,
} from '../src/db/compat';
import type { Database } from '../src/db/client';
import { compatEdges, type NewCompatEdgeRow } from '../src/db/schema';

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

/**
 * The re-mine pass re-reads closures it has already mined, so an already-known
 * pair must cost nothing. Postgres writes a new row version for `DO UPDATE` even
 * when every assigned value is identical, so the `setWhere` predicate — not the
 * SET list — is what keeps those writes off the disk. Asserting on the rendered
 * SQL rather than the call arguments is deliberate: a silently-ignored option
 * would still satisfy an argument check while writing 4.5M rows a pass.
 */
describe('upsertObservedEdgesRemine (no witness re-count, no no-op writes)', () => {
  /** Capture the drizzle onConflictDoUpdate config, then render it for real. */
  async function renderedSql(): Promise<string> {
    let captured: Record<string, unknown> | undefined;
    const db = {
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: (cfg: Record<string, unknown>) => {
            captured = cfg;
            return Promise.resolve(undefined);
          },
        }),
      }),
    } as unknown as Database;
    await upsertObservedEdgesRemine(db, [fakeEdge(1)]);
    expect(captured).toBeDefined();
    // A driverless drizzle renders SQL without connecting; toSQL never executes.
    return drizzle({} as never)
      .insert(compatEdges)
      .values(fakeEdge(1))
      .onConflictDoUpdate(captured as never)
      .toSQL()
      .sql.toLowerCase();
  }

  it('emits a DO UPDATE ... WHERE so unchanged rows are never rewritten', async () => {
    const text = await renderedSql();
    expect(text).toContain('on conflict');
    expect(text).toMatch(/do update set .* where /);
  });

  it('never assigns witness_count — that is what counted cron runs', async () => {
    const text = await renderedSql();
    const doUpdate = text.slice(text.indexOf('do update set'));
    expect(doUpdate).not.toContain('witness_count');
  });

  it('fires only when the incoming edge strictly outranks the stored one', async () => {
    const text = await renderedSql();
    const predicate = text.slice(text.lastIndexOf(' where '));
    // Strict `>`: same-rank observed-on-observed is skipped, but a weaker
    // `declared` row is still upgraded and verified/conflict never downgraded.
    expect(predicate).toContain('>');
    expect(predicate).not.toContain('>=');
    expect(predicate).toContain('conflict');
    expect(predicate).toContain('verified');
  });

  it('chunks like the accruing writer, and no-ops on empty', async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const insert = vi.fn(() => ({ values: () => ({ onConflictDoUpdate }) }));
    const n = EDGE_UPSERT_CHUNK + 1;
    await upsertObservedEdgesRemine({ insert } as unknown as Database,
      Array.from({ length: n }, (_, i) => fakeEdge(i)));
    expect(insert).toHaveBeenCalledTimes(Math.ceil(n / EDGE_UPSERT_CHUNK));

    const empty = vi.fn();
    await upsertObservedEdgesRemine({ insert: empty } as unknown as Database, []);
    expect(empty).not.toHaveBeenCalled();
  });
});
