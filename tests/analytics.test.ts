import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { capture, flush } from '../src/core/analytics';
import { resetConfigCache } from '../src/core/config';

const fetchMock = vi.fn();

function setKey(key: string | undefined) {
  if (key) process.env.LURQ_POSTHOG_KEY = key;
  else delete process.env.LURQ_POSTHOG_KEY;
  resetConfigCache();
}

describe('analytics', () => {
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    await flush();
    setKey(undefined);
    vi.unstubAllGlobals();
  });

  it('sends nothing without a key, or without an owner', async () => {
    setKey(undefined);
    capture('user_1', 'tool_called', { tool: 'evaluate' });
    setKey('phc_test');
    capture(null, 'tool_called', { tool: 'evaluate' });
    capture('', 'tool_called', { tool: 'evaluate' });
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('batches events keyed by the owner into one POST', async () => {
    setKey('phc_test');
    capture('user_1', 'api_key_created', { tier: 'free' });
    capture('user_1', 'tool_called', { tool: 'evaluate', ok: true });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://us.i.posthog.com/batch/');
    const body = JSON.parse(String(init.body));
    expect(body.api_key).toBe('phc_test');
    expect(body.batch.map((e: { event: string }) => e.event)).toEqual(['api_key_created', 'tool_called']);
    expect(body.batch[1].properties).toEqual({ tool: 'evaluate', ok: true, distinct_id: 'user_1' });

    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1); // the queue was drained
  });

  it('a PostHog outage never throws into the caller', async () => {
    setKey('phc_test');
    fetchMock.mockRejectedValue(new Error('network down'));
    capture('user_1', 'tool_called', { tool: 'evaluate' });
    await expect(flush()).resolves.toBeUndefined();
  });
});
