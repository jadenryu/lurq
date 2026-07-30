import { describe, it, expect } from 'vitest';
import { handleReportOutcome } from '../src/mcp/handlers';
import { getOutcomesByOwner } from '../src/db/outcomes';
import type { Database } from '../src/db/client';
import type { NewRecommendationOutcomeRow, RecommendationOutcomeRow } from '../src/db/schema';

/** Minimal fake db capturing the inserted row — recordOutcome is insert-only. */
function fakeDb(): { db: Database; inserted: NewRecommendationOutcomeRow[] } {
  const inserted: NewRecommendationOutcomeRow[] = [];
  const db = {
    insert: () => ({
      values: async (row: NewRecommendationOutcomeRow) => {
        inserted.push(row);
      },
    }),
  } as unknown as Database;
  return { db, inserted };
}

describe('handleReportOutcome', () => {
  it('stamps the server-injected ownerId onto the outcome', async () => {
    const { db, inserted } = fakeDb();
    const res = await handleReportOutcome(
      db,
      { package: 'drizzle-orm', accepted: true, buildSignal: 'tests_passed', need: 'a typesafe ORM' },
      'org_abc123',
    );
    expect(res).toEqual({ recorded: true });
    expect(inserted[0]).toEqual({
      ownerId: 'org_abc123',
      packageName: 'drizzle-orm',
      accepted: true,
      buildSignal: 'tests_passed',
      need: 'a typesafe ORM',
    });
  });

  it('defaults ownerId to null for anonymous/operator keys', async () => {
    const { db, inserted } = fakeDb();
    await handleReportOutcome(db, { package: 'zod', accepted: false });
    expect(inserted[0]).toEqual({
      ownerId: null,
      packageName: 'zod',
      accepted: false,
      buildSignal: null,
      need: null,
    });
  });
});

describe('getOutcomesByOwner', () => {
  function fakeSelectDb(rows: RecommendationOutcomeRow[]) {
    const calls = { limit: undefined as number | undefined };
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: async (n: number) => {
                calls.limit = n;
                return rows;
              },
            }),
          }),
        }),
      }),
    } as unknown as Database;
    return { db, calls };
  }

  it('returns the owner\'s outcomes and defaults the limit to 50', async () => {
    const rows = [{ id: 1, ownerId: 'user_abc' } as RecommendationOutcomeRow];
    const { db, calls } = fakeSelectDb(rows);
    const result = await getOutcomesByOwner(db, 'user_abc');
    expect(result).toBe(rows);
    expect(calls.limit).toBe(50);
  });

  it('honors a custom limit', async () => {
    const { db, calls } = fakeSelectDb([]);
    await getOutcomesByOwner(db, 'user_abc', { limit: 5 });
    expect(calls.limit).toBe(5);
  });
});
