/**
 * Optional Redis response cache for the read-heavy tools (recommend / evaluate /
 * compare). The index only changes when `sync`/`rescore` run, so identical
 * queries can be served from Redis instead of re-running the hybrid search.
 *
 * Zero-config by design: with no `REDIS_URL` (the default, and every end-user's
 * machine), `cached()` is a transparent pass-through and `invalidateCache()` a
 * no-op — nothing to provision, nothing breaks. Point `REDIS_URL` at an Upstash
 * (or any) Redis on the hosted server to turn it on. Any Redis error degrades to
 * computing directly; the cache never takes the request path down.
 *
 * Invalidation is version-based: every key embeds a namespace version read from
 * `lurq:cachever`. A successful sync `INCR`s it, so all prior keys become
 * unreachable at once (and age out via TTL) — no SCAN/DEL sweep.
 */
import { logger } from './logger';

interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>;
  incr(key: string): Promise<number>;
}

const VERSION_KEY = 'lurq:cachever';
const DEFAULT_TTL_SEC = 3600;
/** In-process memo for the namespace version, to avoid a round-trip per call.
 *  Bounded so a sync's INCR is picked up within seconds. */
const VERSION_MEMO_MS = 10_000;

let clientPromise: Promise<RedisLike | null> | null = null;
let versionMemo: { value: string; at: number } | null = null;

function ttlSeconds(): number {
  const n = Number(process.env.LURQ_CACHE_TTL_SEC);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_SEC;
}

/** Lazily connect to Redis once. Returns null (cache disabled) when REDIS_URL is
 *  unset or the client can't be created. */
async function getClient(): Promise<RedisLike | null> {
  if (!process.env.REDIS_URL) return null;
  if (!clientPromise) {
    clientPromise = (async () => {
      try {
        const { default: Redis } = await import('ioredis');
        const client = new Redis(process.env.REDIS_URL!, {
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          lazyConnect: false,
          // Railway's private network (redis.railway.internal) is IPv6-only and
          // ioredis defaults to IPv4 — family:0 lets it resolve either stack, so
          // both the private URL and a public/Upstash URL work unchanged.
          family: 0,
        });
        client.on('error', (err: Error) => logger.warn(`redis: ${err.message}`));
        logger.info('Response cache enabled (REDIS_URL set).');
        return client as unknown as RedisLike;
      } catch (err) {
        logger.warn(`redis disabled (init failed): ${(err as Error).message}`);
        return null;
      }
    })();
  }
  return clientPromise;
}

async function namespaceVersion(client: RedisLike): Promise<string> {
  if (versionMemo && Date.now() - versionMemo.at < VERSION_MEMO_MS) return versionMemo.value;
  const value = (await client.get(VERSION_KEY).catch(() => null)) ?? '0';
  versionMemo = { value, at: Date.now() };
  return value;
}

/**
 * Get-or-compute with optional caching. When the cache is off or unreachable,
 * `compute()` runs directly. `skipCache(value)` lets the caller avoid caching
 * unhelpful results (e.g. empty recommendations or not-found lookups).
 */
export async function cached<T>(
  namespace: string,
  key: string,
  compute: () => Promise<T>,
  opts: { skipCache?: (value: T) => boolean } = {},
): Promise<T> {
  const client = await getClient();
  if (!client) return compute();

  let fullKey: string;
  try {
    const version = await namespaceVersion(client);
    fullKey = `lurq:${namespace}:${version}:${key}`;
    const hit = await client.get(fullKey);
    if (hit != null) return JSON.parse(hit) as T;
  } catch (err) {
    logger.warn(`redis read failed, bypassing cache: ${(err as Error).message}`);
    return compute();
  }

  const value = await compute();
  if (!opts.skipCache?.(value)) {
    // Fire-and-forget write; a cache-write failure must never affect the response.
    client.set(fullKey, JSON.stringify(value), 'EX', ttlSeconds()).catch(() => {});
  }
  return value;
}

/** Invalidate every cached read by bumping the namespace version. Call after a
 *  successful sync/rescore. No-op when the cache is off. */
export async function invalidateCache(): Promise<void> {
  const client = await getClient();
  if (!client) return;
  try {
    await client.incr(VERSION_KEY);
    versionMemo = null; // force the next read to pick up the new version
  } catch (err) {
    logger.warn(`redis invalidate failed: ${(err as Error).message}`);
  }
}
