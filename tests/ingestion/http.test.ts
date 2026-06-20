import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { httpRequest, HttpError, __resetHttpStateForTests } from '../../src/core/http';

const CACHE_DIR = join(tmpdir(), 'lurq-http-test');

function makeResponse(status: number, body: string, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    text: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  __resetHttpStateForTests();
  process.env.LURQ_CACHE_DIR = CACHE_DIR;
});

afterAll(async () => {
  await rm(CACHE_DIR, { recursive: true, force: true });
});

describe('http layer', () => {
  it('serves the second identical request from cache', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return makeResponse(200, JSON.stringify({ x: 1 }));
    }) as unknown as typeof fetch;

    const url = 'https://example.test/cache-hit';
    const a = await httpRequest<{ x: number }>(url, { host: 'h', ttlMs: 10_000, fetchImpl });
    const b = await httpRequest<{ x: number }>(url, { host: 'h', ttlMs: 10_000, fetchImpl });

    expect(calls).toBe(1);
    expect(a.fromCache).toBe(false);
    expect(b.fromCache).toBe(true);
    expect(b.data.x).toBe(1);
  });

  it('does not cache when ttlMs is 0', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return makeResponse(200, JSON.stringify({ ok: true }));
    }) as unknown as typeof fetch;

    const url = 'https://example.test/no-cache';
    await httpRequest(url, { host: 'h', ttlMs: 0, fetchImpl });
    await httpRequest(url, { host: 'h', ttlMs: 0, fetchImpl });
    expect(calls).toBe(2);
  });

  it('retries retryable 5xx then succeeds', async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      return n === 1 ? makeResponse(503, 'busy') : makeResponse(200, JSON.stringify({ ok: 1 }));
    }) as unknown as typeof fetch;

    const res = await httpRequest<{ ok: number }>('https://example.test/retry', {
      host: 'h',
      ttlMs: 0,
      fetchImpl,
    });
    expect(n).toBe(2);
    expect(res.data.ok).toBe(1);
  });

  it('throws immediately on a non-retryable 404 (no retries)', async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      return makeResponse(404, 'not found');
    }) as unknown as typeof fetch;

    await expect(
      httpRequest('https://example.test/missing', { host: 'h', ttlMs: 0, fetchImpl }),
    ).rejects.toBeInstanceOf(HttpError);
    expect(n).toBe(1);
  });
});
