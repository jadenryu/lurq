/**
 * Server-side product events for PostHog, sent over its public `/batch/` capture
 * API with plain `fetch`. No SDK on purpose: `serve-http` ships inside the
 * published `lurq` bundle, and every CLI install would otherwise carry a client
 * it never runs.
 *
 * Events are keyed by the Clerk user id, the same id the web app passes to
 * `posthog.identify`, so a visitor's landing → sign-up → key → first tool call
 * reads as one person. Only account-owned calls on the hosted service are sent:
 * no key configured or no owner (stdio, local, operator keys) means no event,
 * which keeps the privacy page's promise that the CLI sends no telemetry.
 *
 * Display analytics, not a ledger. A failed batch is dropped, never retried.
 */
import { getConfig } from './config';
import { logger } from './logger';

// US cloud, matching the web app's /ingest rewrites in apps/web/next.config.ts.
const HOST = 'https://us.i.posthog.com';
const FLUSH_AT = 50;
const FLUSH_MS = 10_000;

interface QueuedEvent {
  event: string;
  properties: Record<string, unknown>;
  timestamp: string;
}

let queue: QueuedEvent[] = [];
let timer: NodeJS.Timeout | null = null;

/** Queue one event for `distinctId`. A no-op without an owner or a key. */
export function capture(
  distinctId: string | null | undefined,
  event: string,
  properties: Record<string, unknown> = {},
): void {
  if (!distinctId || !getConfig().LURQ_POSTHOG_KEY) return;
  queue.push({
    event,
    properties: { ...properties, distinct_id: distinctId },
    timestamp: new Date().toISOString(),
  });
  if (queue.length >= FLUSH_AT) {
    void flush();
  } else if (!timer) {
    timer = setTimeout(() => void flush(), FLUSH_MS);
    timer.unref(); // pending analytics must never keep the process alive
  }
}

/** Send everything queued. Never throws; call it on shutdown to drain. */
export async function flush(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const key = getConfig().LURQ_POSTHOG_KEY;
  if (!key || queue.length === 0) return;
  const batch = queue;
  queue = [];
  try {
    const res = await fetch(`${HOST}/batch/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key, batch }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) logger.warn(`posthog batch rejected (${res.status}), dropped ${batch.length} event(s)`);
  } catch (err) {
    logger.warn('posthog batch failed:', err instanceof Error ? err.message : String(err));
  }
}
