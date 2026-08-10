import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import {
  generateApiKey,
  hashKey,
  lookupActiveKey,
  resetAuthCache,
  listKeysForOwner,
  findKeyForOwner,
} from '../src/auth/apiKeys';
import { API_KEY_PREFIX } from '../src/core/constants';
import type { Database } from '../src/db/client';
import type { ApiKeyRow } from '../src/db/schema';

describe('hashKey', () => {
  it('is a deterministic sha256 hex of the key', () => {
    const key = 'lurq_live_example';
    const expected = createHash('sha256').update(key).digest('hex');
    expect(hashKey(key)).toBe(expected);
    expect(hashKey(key)).toHaveLength(64);
  });
});

describe('generateApiKey', () => {
  it('produces a prefixed, high-entropy key with a matching hash and display prefix', () => {
    const { key, hash, prefix } = generateApiKey();
    expect(key.startsWith(API_KEY_PREFIX)).toBe(true);
    // body is 24 random bytes → 32 base64url chars
    expect(key.length).toBe(API_KEY_PREFIX.length + 32);
    expect(hash).toBe(hashKey(key));
    // display prefix is the key prefix + first 6 chars of the body, and is itself a prefix of the key
    expect(prefix.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(key.startsWith(prefix)).toBe(true);
  });

  it('is unique across calls', () => {
    const keys = new Set(Array.from({ length: 100 }, () => generateApiKey().key));
    expect(keys.size).toBe(100);
  });

  it('only emits URL/header-safe characters (base64url + prefix)', () => {
    const { key } = generateApiKey();
    const body = key.slice(API_KEY_PREFIX.length);
    expect(body).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('lookupActiveKey caching', () => {
  beforeEach(() => resetAuthCache());

  function fakeDb() {
    const counts = { select: 0, update: 0 };
    const row = { id: 7, keyHash: 'h', prefix: 'lurq_live_x', revokedAt: null } as ApiKeyRow;
    const db = {
      select: () => {
        counts.select += 1;
        return { from: () => ({ where: () => ({ limit: async () => [row] }) }) };
      },
      update: () => {
        counts.update += 1;
        return { set: () => ({ where: () => Promise.resolve() }) };
      },
    } as unknown as Database;
    return { db, counts, row };
  }

  it('serves repeated lookups from cache — one SELECT, not N', async () => {
    const { db, counts, row } = fakeDb();
    const k = 'lurq_live_secret';
    expect((await lookupActiveKey(db, k))?.id).toBe(row.id);
    expect((await lookupActiveKey(db, k))?.id).toBe(row.id);
    expect((await lookupActiveKey(db, k))?.id).toBe(row.id);
    expect(counts.select).toBe(1); // 2nd/3rd calls hit the cache
  });

  it('stamps lastUsedAt at most once per interval', async () => {
    const { db, counts } = fakeDb();
    const k = 'lurq_live_secret';
    await lookupActiveKey(db, k);
    await lookupActiveKey(db, k);
    await lookupActiveKey(db, k);
    expect(counts.update).toBe(1); // throttled, not once per request
  });
});

describe('listKeysForOwner', () => {
  it('selects only the given owner\'s keys, newest first', async () => {
    let whereArg: unknown;
    const rows = [{ id: 2, ownerId: 'user_abc' } as ApiKeyRow];
    const db = {
      select: () => ({
        from: () => ({
          where: (arg: unknown) => {
            whereArg = arg;
            return { orderBy: async () => rows };
          },
        }),
      }),
    } as unknown as Database;

    const result = await listKeysForOwner(db, 'user_abc');
    expect(result).toBe(rows);
    expect(whereArg).toBeDefined();
  });
});

describe('findKeyForOwner', () => {
  /** Bound scalar values inside a drizzle condition tree, in SQL order. */
  function boundParams(condition: unknown): unknown[] {
    const out: unknown[] = [];
    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (node.value !== undefined && !Array.isArray(node.queryChunks)) out.push(node.value);
      for (const chunk of node.queryChunks ?? []) walk(chunk);
    };
    walk(condition);
    return out;
  }

  /**
   * A fake that answers only what the WHERE clause actually asked for.
   *
   * The previous fake ignored the condition entirely and returned its row
   * regardless, so it could not tell a query that filters by owner from one
   * that does not — which is precisely how the JS-side ownership check passed
   * review. This one hands back the table rows the SQL selects for, so a query
   * that forgets the owner sees every owner's keys, exactly as Postgres would.
   */
  function fakeDb(table: ApiKeyRow[]) {
    return {
      select: () => ({
        from: () => ({
          where: (condition: unknown) => {
            const params = boundParams(condition);
            // Owner ids are the only `user_`-shaped binding in this query, so
            // its absence means the WHERE never mentioned the owner — and the
            // fake then behaves like a database that was not asked to scope.
            const owner = params.find((p) => typeof p === 'string' && p.startsWith('user_'));
            const rows = table
              .filter(
                (r) =>
                  !r.revokedAt &&
                  (params.includes(r.prefix) || params.includes(r.id)) &&
                  (owner === undefined || r.ownerId === owner),
              )
              .sort((a, b) => a.id - b.id);
            return { orderBy: () => ({ limit: async () => rows }) };
          },
        }),
      }),
    } as unknown as Database;
  }

  const key = (over: Partial<ApiKeyRow>) =>
    ({ id: 1, prefix: 'lurq_live_ab12cd', ownerId: 'user_abc', revokedAt: null, ...over }) as ApiKeyRow;

  it('returns the key when the prefix belongs to the given owner', async () => {
    const row = key({});
    const result = await findKeyForOwner(fakeDb([row]), {
      prefixOrId: 'lurq_live_ab12cd',
      ownerId: 'user_abc',
    });
    expect(result).toEqual(row);
  });

  it('returns null when the prefix belongs to a different owner', async () => {
    const db = fakeDb([key({ ownerId: 'user_other' })]);
    const result = await findKeyForOwner(db, { prefixOrId: 'lurq_live_ab12cd', ownerId: 'user_abc' });
    expect(result).toBeNull();
  });

  it('returns null when no active key matches the prefix at all', async () => {
    const db = fakeDb([]);
    const result = await findKeyForOwner(db, { prefixOrId: 'lurq_live_missing', ownerId: 'user_abc' });
    expect(result).toBeNull();
  });

  // The regression: two owners whose keys collide on the 6-char display prefix.
  // Scoping the owner in JS after LIMIT 1 meant the database was free to return
  // the other account's row, and the caller — who can see this key in their own
  // dashboard list — could never revoke or rotate it.
  it('finds the caller’s own key when another account shares the prefix', async () => {
    const mine = key({ id: 7, ownerId: 'user_abc' });
    const theirs = key({ id: 2, ownerId: 'user_other' });
    // `theirs` sorts first by id, so an unscoped LIMIT 1 picks it.
    const result = await findKeyForOwner(fakeDb([theirs, mine]), {
      prefixOrId: 'lurq_live_ab12cd',
      ownerId: 'user_abc',
    });
    expect(result).toEqual(mine);
  });
});
