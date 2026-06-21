/**
 * Shared HTTP layer (§17). One wrapper for every external call:
 *  - per-host rate limiting (max concurrency + minimum gap between starts),
 *  - exponential backoff on 429 / 5xx (respecting Retry-After),
 *  - in-run (memory) cache + persistent on-disk cache with per-source TTLs.
 *
 * Source clients pass a `ttlMs` (the per-source TTL from §17) and a `host`
 * bucket. `ttlMs: 0` disables caching (used for liveness checks like `verify`).
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { logger } from './logger';

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface HttpOptions {
  /** Rate-limit bucket key, usually the hostname. */
  host: string;
  /** Persistent cache TTL in ms. 0 disables read+write caching. */
  ttlMs: number;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  accept?: 'json' | 'text';
  timeoutMs?: number;
  retries?: number;
  /** Override the cache key (e.g. to keep auth tokens out of the key). */
  cacheKey?: string;
  /** Injected for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface HttpResponse<T> {
  status: number;
  data: T;
  fromCache: boolean;
}

// ── Per-host rate limiting ──────────────────────────────────────────────────

interface HostConfig {
  maxConcurrent: number;
  minIntervalMs: number;
}

const DEFAULT_HOST_CONFIG: HostConfig = { maxConcurrent: 6, minIntervalMs: 0 };

const HOST_CONFIG: Record<string, HostConfig> = {
  'api.github.com': { maxConcurrent: 4, minIntervalMs: 50 },
  'registry.npmjs.org': { maxConcurrent: 4, minIntervalMs: 50 },
  // The downloads API rate-limits aggressively — serialize with a steady gap.
  // Weekly downloads go through the bulk endpoint; only growth hits this often.
  'api.npmjs.org': { maxConcurrent: 1, minIntervalMs: 250 },
  'api.deps.dev': { maxConcurrent: 4, minIntervalMs: 40 },
  'raw.githubusercontent.com': { maxConcurrent: 4, minIntervalMs: 30 },
  // Bundlephobia is slow/flaky — be gentle (§9.5).
  'bundlephobia.com': { maxConcurrent: 2, minIntervalMs: 200 },
};

class HostLimiter {
  private active = 0;
  private nextAvailable = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly config: HostConfig) {}

  async acquire(): Promise<void> {
    if (this.active >= this.config.maxConcurrent) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    const now = Date.now();
    const wait = Math.max(0, this.nextAvailable - now);
    this.nextAvailable = Math.max(now, this.nextAvailable) + this.config.minIntervalMs;
    if (wait > 0) await delay(wait);
  }

  release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

const limiters = new Map<string, HostLimiter>();

function limiterFor(host: string): HostLimiter {
  let limiter = limiters.get(host);
  if (!limiter) {
    limiter = new HostLimiter(HOST_CONFIG[host] ?? DEFAULT_HOST_CONFIG);
    limiters.set(host, limiter);
  }
  return limiter;
}

// ── Caching ─────────────────────────────────────────────────────────────────

interface CacheEntry {
  fetchedAt: number;
  status: number;
  body: string;
}

const memoryCache = new Map<string, CacheEntry>();

/** When true, cache reads are skipped (writes still happen). Used by `sync --full`. */
let bypassCacheRead = false;

/** Force fresh fetches (ignore cache TTLs) while still refreshing the cache. */
export function setCacheBypassRead(value: boolean): void {
  bypassCacheRead = value;
}

function cacheDir(): string {
  return process.env.LURQ_CACHE_DIR ?? join(homedir(), '.cache', 'lurq', 'http');
}

function cacheFile(key: string): string {
  const hash = createHash('sha256').update(key).digest('hex');
  return join(cacheDir(), `${hash}.json`);
}

async function readCache(key: string, ttlMs: number): Promise<CacheEntry | undefined> {
  const now = Date.now();
  const mem = memoryCache.get(key);
  if (mem && now - mem.fetchedAt < ttlMs) return mem;

  const file = cacheFile(key);
  if (!existsSync(file)) return undefined;
  try {
    const entry = JSON.parse(await readFile(file, 'utf8')) as CacheEntry;
    if (now - entry.fetchedAt < ttlMs) {
      memoryCache.set(key, entry);
      return entry;
    }
  } catch {
    /* corrupt cache file — ignore and refetch */
  }
  return undefined;
}

async function writeCache(key: string, entry: CacheEntry): Promise<void> {
  memoryCache.set(key, entry);
  const file = cacheFile(key);
  try {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(entry), 'utf8');
  } catch (err) {
    logger.debug(`http cache write failed: ${(err as Error).message}`);
  }
}

// ── Core request ────────────────────────────────────────────────────────────

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export async function httpRequest<T = unknown>(
  url: string,
  opts: HttpOptions,
): Promise<HttpResponse<T>> {
  const {
    host,
    ttlMs,
    method = 'GET',
    headers = {},
    body,
    accept = 'json',
    timeoutMs = 15_000,
    retries = 3,
    fetchImpl = fetch,
  } = opts;
  const key = opts.cacheKey ?? `${method} ${url} ${body ?? ''}`;

  if (ttlMs > 0 && !bypassCacheRead) {
    const cached = await readCache(key, ttlMs);
    if (cached) {
      return { status: cached.status, data: decode<T>(cached.body, accept), fromCache: true };
    }
  }

  const limiter = limiterFor(host);
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    await limiter.acquire();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { method, headers, body, signal: controller.signal });
      const text = await res.text();

      if (res.ok) {
        if (ttlMs > 0) await writeCache(key, { fetchedAt: Date.now(), status: res.status, body: text });
        return { status: res.status, data: decode<T>(text, accept), fromCache: false };
      }

      // Non-2xx
      if (RETRYABLE.has(res.status) && attempt < retries) {
        const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
        await delay(retryAfter ?? backoff(attempt));
        lastErr = new HttpError(`HTTP ${res.status} for ${url}`, res.status, url);
        continue;
      }
      throw new HttpError(`HTTP ${res.status} for ${url}`, res.status, url);
    } catch (err) {
      lastErr = err;
      const isAbort = err instanceof Error && err.name === 'AbortError';
      const isHttp = err instanceof HttpError;
      // Retry network/timeout errors; don't retry non-retryable HTTP statuses.
      if (isHttp && !RETRYABLE.has(err.status)) throw err;
      if (attempt < retries) {
        await delay(backoff(attempt));
        continue;
      }
      if (isAbort) throw new HttpError(`Timeout after ${timeoutMs}ms for ${url}`, 0, url);
    } finally {
      clearTimeout(timer);
      limiter.release();
    }
  }
  throw lastErr instanceof Error ? lastErr : new HttpError(`Request failed for ${url}`, 0, url);
}

export async function httpGetJson<T = unknown>(
  url: string,
  opts: Omit<HttpOptions, 'accept' | 'method'>,
): Promise<HttpResponse<T>> {
  return httpRequest<T>(url, { ...opts, method: 'GET', accept: 'json' });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function decode<T>(text: string, accept: 'json' | 'text'): T {
  if (accept === 'text') return text as unknown as T;
  return (text ? JSON.parse(text) : null) as T;
}

function backoff(attempt: number): number {
  const base = 500 * 2 ** attempt;
  return base + Math.floor(((attempt * 137) % 100) * 3); // small deterministic jitter
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (!Number.isNaN(seconds)) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Test helper: clear the in-memory cache and per-host limiters. */
export function __resetHttpStateForTests(): void {
  memoryCache.clear();
  limiters.clear();
}
