// ponytail: in-memory fixed-window limiter — per serverless instance, so it
// resets on cold start and doesn't share counts across instances. It throttles
// bursts from a single instance, which is what a marketing form needs. Swap for
// @upstash/ratelimit (durable, cross-instance) if abuse outgrows this.

type Bucket = { count: number; reset: number };
const buckets = new Map<string, Bucket>();

/**
 * Returns true if the request under `key` is allowed. Fixed window: up to `max`
 * requests per `windowMs`, then blocked until the window rolls over.
 */
export function rateLimit(key: string, max = 5, windowMs = 60_000): boolean {
  const now = Date.now();
  const b = buckets.get(key);

  if (!b || now > b.reset) {
    // Opportunistic sweep so unique keys don't grow the map unbounded.
    if (buckets.size > 10_000) {
      for (const [k, v] of buckets) if (now > v.reset) buckets.delete(k);
    }
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }

  if (b.count >= max) return false;
  b.count++;
  return true;
}
