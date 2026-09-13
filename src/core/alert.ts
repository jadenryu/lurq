/**
 * Operator alerts: one JSON POST to a Slack- or Discord-compatible incoming
 * webhook when the hosted service fails in a way nobody would otherwise see.
 *
 * Railway keeps the logs, but nobody reads logs until something already looks
 * broken, and the failures this exists for do not look broken from outside: a
 * Stripe event that did not apply leaves a paying customer quietly on Free, and
 * a GitHub webhook that failed leaves a repo quietly missing from the dashboard.
 *
 * No SDK and no vendor account, on purpose: `serve-http` ships inside the
 * published CLI bundle, and an incoming webhook is a URL the operator already
 * has. Plain `fetch`, like core/analytics.ts. The URL is operator config, not
 * user input, so it skips the SSRF guard that notify/safeHttp.ts puts in front
 * of customer-supplied channel URLs.
 *
 * Fire-and-forget: never awaited by the request path, never throws, short
 * timeout. Callers pass a fixed kind and a short detail they build themselves.
 * Never a request body, header, or raw error message: a driver error can quote
 * the values it rejected, and this channel is readable by whoever is in it.
 */
import { getConfig } from './config';
import { logger } from './logger';

/** At most one alert per kind in this window, per process. */
export const ALERT_WINDOW_MS = 5 * 60_000;
const TIMEOUT_MS = 3_000;

/**
 * A closed set, so the rate-limit map below stays bounded no matter what
 * fails, and a burst of 500s across a hundred paths is one alert, not a hundred.
 */
export type AlertKind = 'stripe-webhook' | 'github-webhook' | 'server-error';

const lastSent = new Map<AlertKind, number>();

/** Test-only: forget the rate-limit state. */
export function resetAlerts(): void {
  lastSent.clear();
}

/** Post one alert if configured and not rate-limited. Returns whether it sent. */
export function alert(kind: AlertKind, detail: string, now = Date.now()): boolean {
  const url = getConfig().LURQ_ALERT_WEBHOOK_URL;
  if (!url) return false;
  const last = lastSent.get(kind);
  if (last !== undefined && now - last < ALERT_WINDOW_MS) return false;
  lastSent.set(kind, now);

  const text = `lurq ${kind}: ${detail.slice(0, 500)} (further ${kind} alerts muted for 5 min; see the service logs)`;
  // `text` is Slack's field and `content` is Discord's; each ignores the other.
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, content: text }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).then(
    (res) => {
      if (!res.ok) logger.warn(`alert webhook rejected (${res.status})`);
    },
    (err) => logger.warn('alert webhook failed:', err instanceof Error ? err.message : String(err)),
  );
  return true;
}

/** A thrown value's class or code, never its message. */
export function errorKind(err: unknown): string {
  if (err && typeof err === 'object') {
    const code = (err as { code?: unknown }).code;
    const name = err instanceof Error ? err.name : 'Error';
    return typeof code === 'string' ? `${name} (${code})` : name;
  }
  return typeof err;
}
