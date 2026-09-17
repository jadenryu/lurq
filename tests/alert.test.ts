import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const config: { LURQ_ALERT_WEBHOOK_URL?: string } = {};
vi.mock('../src/core/config', () => ({ getConfig: () => config }));

import { ALERT_WINDOW_MS, alert, errorKind, resetAlerts } from '../src/core/alert';

describe('alert', () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));

  beforeEach(() => {
    resetAlerts();
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
    config.LURQ_ALERT_WEBHOOK_URL = 'https://hooks.slack.com/services/T/B/x';
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends nothing when unconfigured', () => {
    delete config.LURQ_ALERT_WEBHOOK_URL;
    expect(alert('server-error', 'POST /mcp → 500')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts a Slack- and Discord-readable body', () => {
    expect(alert('stripe-webhook', 'evt_1 failed')).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(config.LURQ_ALERT_WEBHOOK_URL);
    const body = JSON.parse(String(init.body)) as { text: string; content: string };
    expect(body.text).toContain('stripe-webhook: evt_1 failed');
    expect(body.content).toBe(body.text);
  });

  it('rate-limits per kind, not globally', () => {
    const t = 1_000_000;
    expect(alert('server-error', 'a', t)).toBe(true);
    expect(alert('server-error', 'b', t + 1_000)).toBe(false);
    expect(alert('github-webhook', 'c', t + 1_000)).toBe(true);
    expect(alert('server-error', 'd', t + ALERT_WINDOW_MS)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('never throws when the webhook is down', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(() => alert('server-error', 'x')).not.toThrow();
    await new Promise((r) => setImmediate(r));
  });
});

describe('errorKind', () => {
  it('reports the class and code, never the message', () => {
    const err = Object.assign(new Error('duplicate key value (secret@example.com)'), { code: '23505' });
    expect(errorKind(err)).toBe('Error (23505)');
    expect(errorKind(new TypeError('x'))).toBe('TypeError');
  });
});
