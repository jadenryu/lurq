import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isOwner } from '../src/core/gate';

// The owner secret is never committed, so these cover the security-critical
// rejection paths. The accept path is verified manually against the live env.
describe('isOwner', () => {
  const original = process.env.LURQ_OWNER_KEY;
  beforeEach(() => {
    delete process.env.LURQ_OWNER_KEY;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.LURQ_OWNER_KEY;
    else process.env.LURQ_OWNER_KEY = original;
  });

  it('is false when LURQ_OWNER_KEY is unset', () => {
    expect(isOwner()).toBe(false);
  });

  it('is false for an empty key', () => {
    process.env.LURQ_OWNER_KEY = '';
    expect(isOwner()).toBe(false);
  });

  it('is false for a wrong key', () => {
    process.env.LURQ_OWNER_KEY = 'not-the-secret';
    expect(isOwner()).toBe(false);
  });

  it('does not throw on keys of unusual length (no buffer-length crash)', () => {
    process.env.LURQ_OWNER_KEY = 'x'.repeat(500);
    expect(() => isOwner()).not.toThrow();
    expect(isOwner()).toBe(false);
  });
});
