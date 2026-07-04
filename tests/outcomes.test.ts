import { describe, it, expect } from 'vitest';
import { handleReportOutcome } from '../src/mcp/handlers';
import type { Database } from '../src/db/client';
import type { NewRecommendationOutcomeRow } from '../src/db/schema';

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
  it('records the package, decision, and build signal', async () => {
    const { db, inserted } = fakeDb();
    const res = await handleReportOutcome(db, {
      package: 'drizzle-orm',
      accepted: true,
      buildSignal: 'tests_passed',
      need: 'a typesafe ORM',
    });
    expect(res).toEqual({ recorded: true });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toEqual({
      packageName: 'drizzle-orm',
      accepted: true,
      buildSignal: 'tests_passed',
      need: 'a typesafe ORM',
    });
  });

  it('normalizes omitted optional fields to null', async () => {
    const { db, inserted } = fakeDb();
    await handleReportOutcome(db, { package: 'zod', accepted: false });
    expect(inserted[0]).toEqual({
      packageName: 'zod',
      accepted: false,
      buildSignal: null,
      need: null,
    });
  });
});
