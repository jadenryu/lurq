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
  function fakeDb(row: ApiKeyRow | undefined) {
    return {
      select: () => ({
        from: () => ({ where: () => ({ limit: async () => (row ? [row] : []) }) }),
      }),
    } as unknown as Database;
  }

  it('returns the key when the prefix belongs to the given owner', async () => {
    const row = { id: 1, prefix: 'lurq_live_ab12cd', ownerId: 'user_abc', revokedAt: null } as ApiKeyRow;
    const db = fakeDb(row);
    const result = await findKeyForOwner(db, { prefixOrId: 'lurq_live_ab12cd', ownerId: 'user_abc' });
    expect(result).toBe(row);
  });

  it('returns null when the prefix belongs to a different owner', async () => {
    const row = { id: 1, prefix: 'lurq_live_ab12cd', ownerId: 'user_other', revokedAt: null } as ApiKeyRow;
    const db = fakeDb(row);
    const result = await findKeyForOwner(db, { prefixOrId: 'lurq_live_ab12cd', ownerId: 'user_abc' });
    expect(result).toBeNull();
  });

  it('returns null when no active key matches the prefix at all', async () => {
    const db = fakeDb(undefined);
    const result = await findKeyForOwner(db, { prefixOrId: 'lurq_live_missing', ownerId: 'user_abc' });
    expect(result).toBeNull();
  });
});
