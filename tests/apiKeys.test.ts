import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { generateApiKey, hashKey } from '../src/auth/apiKeys';
import { API_KEY_PREFIX } from '../src/core/constants';

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
