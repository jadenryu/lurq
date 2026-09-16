import { describe, expect, it } from 'vitest';
import type { OwnerPublicChange } from '../src/db/publicMcpAlerts';
import { parsePublicItemKey, publicChannelItem, publicItemKey, publicUrgentItem } from '../src/notify/publicSources';

const change = (over: Partial<OwnerPublicChange> = {}): OwnerPublicChange => ({
  ownerId: 'user_2abc:with-colon',
  changeId: 42,
  endpointId: 7,
  url: 'https://mcp.x.dev/mcp',
  kind: 'contract',
  severity: 'high',
  summary: 'https://mcp.x.dev/mcp: 1 tool(s) removed',
  diff: null,
  createdAt: new Date('2026-09-15T00:00:00Z'),
  via: 'pin',
  label: 'weather',
  ...over,
});

describe('public item keys', () => {
  it('carry the account, so one shared change can reach every account once', () => {
    expect(publicItemKey(42, 'user_a')).not.toBe(publicItemKey(42, 'user_b'));
    expect(parsePublicItemKey(publicItemKey(42, 'user_2abc:with-colon'))).toEqual({ changeId: 42, ownerId: 'user_2abc:with-colon' });
  });

  it('ignore keys they did not issue', () => {
    expect(parsePublicItemKey('mcp:42')).toBeNull();
    expect(parsePublicItemKey('pub:x:user')).toBeNull();
    expect(parsePublicItemKey('pub:42:')).toBeNull();
  });
});

describe('publicUrgentItem', () => {
  it('is urgent only for high and critical changes', () => {
    expect(publicUrgentItem(change({ severity: 'moderate' }), 'https://lurq.run')).toBeNull();
    expect(publicUrgentItem(change({ severity: 'critical' }), 'https://lurq.run')).not.toBeNull();
  });

  it('says what changed, why this account hears about it, and what to do', () => {
    const pinned = publicUrgentItem(change(), 'https://lurq.run')!;
    expect(pinned).toMatchObject({ kind: 'mcp_public_change', title: 'weather changed the tools your agent calls since you pinned it', url: 'https://lurq.run/dashboard/mcp/public/7' });
    expect(pinned.detail).toMatch(/1 tool\(s\) removed.*re-pin/);
    const scanned = publicUrgentItem(change({ via: 'deployment', kind: 'auth', summary: 'Dynamic Client Registration no longer offered' }), 'https://lurq.run')!;
    expect(scanned.title).toBe('weather changed how clients sign in since your last scan');
    expect(scanned.detail).toMatch(/still sign in/);
  });
});

describe('publicChannelItem', () => {
  it('keeps the change severity for the channel threshold to filter', () => {
    expect(publicChannelItem(change({ severity: 'low' }), 'https://lurq.run')).toMatchObject({ severity: 'low', source: 'mcp', key: 'pub:42:user_2abc:with-colon' });
  });
});
