// ponytail: in-memory fixed-window limiter, per serverless instance, so it
// resets on cold start and doesn't share counts across instances. It throttles
// bursts from a single instance, which is what a marketing form needs. Swap for
// @upstash/ratelimit (durable, cross-instance) if abuse outgrows this.

type Bucket = { count: number; reset: number };
const buckets = new Map<string, Bucket>();

export type RateLimitResult = {
  /** False once the window's budget is spent. */
  ok: boolean;
  /** Ceiling for this window. */
  limit: number;
  /** Requests left in this window, floored at 0. */
  remaining: number;
  /** Unix seconds at which the window rolls over. */
  reset: number;
  /** Whole seconds until the window rolls over, floored at 1. */
  retryAfter: number;
};

/**
 * Fixed window: up to `max` requests per `windowMs` under `key`, then blocked
 * until the window rolls over.
 *
 * Named `checkRateLimit` rather than `rateLimit` on purpose. The old function
 * returned a bare boolean and every caller wrote `if (!rateLimit(...))`; a
 * silent switch to an object return would have made that `!{...}` — always
 * false, valid TypeScript, and every limiter on the site quietly disabled.
 * Renaming makes the old call sites a compile error instead of an outage.
 */
export function checkRateLimit(key: string, max = 5, windowMs = 60_000): RateLimitResult {
  const now = Date.now();
  const b = buckets.get(key);

  if (!b || now > b.reset) {
    // Opportunistic sweep so unique keys don't grow the map unbounded.
    if (buckets.size > 10_000) {
      for (const [k, v] of buckets) if (now > v.reset) buckets.delete(k);
    }
    const reset = now + windowMs;
    buckets.set(key, { count: 1, reset });
    return result(true, max, max - 1, reset, now);
  }

  if (b.count >= max) return result(false, max, 0, b.reset, now);
  b.count++;
  return result(true, max, max - b.count, b.reset, now);
}

function result(
  ok: boolean,
  limit: number,
  remaining: number,
  reset: number,
  now: number,
): RateLimitResult {
  return {
    ok,
    limit,
    remaining: Math.max(0, remaining),
    reset: Math.ceil(reset / 1000),
    retryAfter: Math.max(1, Math.ceil((reset - now) / 1000)),
  };
}

/**
 * The headers that tell a caller how much budget is left and when to come back.
 *
 * `RateLimit-*` is the IETF draft-7 spelling the API server already emits via
 * express-rate-limit, so a client that understands one understands both. The
 * `X-RateLimit-*` aliases are there because most HTTP clients and dashboards
 * still only look for those. `Retry-After` is the one a well-behaved agent
 * actually obeys, and it is only meaningful on a rejection.
 */
export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    "RateLimit-Limit": String(r.limit),
    "RateLimit-Remaining": String(r.remaining),
    "RateLimit-Reset": String(r.retryAfter),
    "X-RateLimit-Limit": String(r.limit),
    "X-RateLimit-Remaining": String(r.remaining),
    "X-RateLimit-Reset": String(r.reset),
  };
  if (!r.ok) headers["Retry-After"] = String(r.retryAfter);
  return headers;
}
