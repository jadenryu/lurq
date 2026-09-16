import { describe, expect, it } from 'vitest';
import { CADENCE, isFailure, nextProbeAt } from '../src/remoteProbe/schedule';
import { endpointIdentity } from '../src/remoteProbe/url';

describe('endpointIdentity', () => {
  it('folds only what URLs define as equivalent', () => {
    expect(endpointIdentity('HTTPS://Mcp.Acme.DEV:443/mcp#frag')).toEqual({ url: 'https://mcp.acme.dev/mcp', host: 'mcp.acme.dev', templated: false });
    expect(endpointIdentity('https://mcp.acme.dev/')!.url).toBe('https://mcp.acme.dev');
    expect(endpointIdentity('https://mcp.acme.dev/MCP/')!.url).toBe('https://mcp.acme.dev/MCP/');
    expect(endpointIdentity('https://mcp.acme.dev/mcp?tenant=A')!.url).toBe('https://mcp.acme.dev/mcp?tenant=A');
    expect(endpointIdentity('https://mcp.acme.dev:8443/mcp')!.url).toBe('https://mcp.acme.dev:8443/mcp');
  });

  it('marks templated URLs and keeps them verbatim', () => {
    expect(endpointIdentity('https://{tenant}.acme.dev/mcp')).toEqual({ url: 'https://{tenant}.acme.dev/mcp', host: 'placeholder.acme.dev', templated: true });
    expect(endpointIdentity('https://mcp.acme.dev/{workspace}/mcp')!.templated).toBe(true);
  });

  it('rejects what is not an http(s) URL', () => {
    expect(endpointIdentity('stdio://x')).toBeNull();
    expect(endpointIdentity('not a url')).toBeNull();
    expect(endpointIdentity('')).toBeNull();
    expect(endpointIdentity(`https://x.dev/${'a'.repeat(3_000)}`)).toBeNull();
  });
});

describe('nextProbeAt', () => {
  const now = new Date('2026-09-15T00:00:00Z');
  const after = (d: Date) => d.getTime() - now.getTime();
  const within = (ms: number, target: number) => ms >= target * 0.9 && ms <= target * 1.1;

  it('reads healthy endpoints daily, and more often right after a change', () => {
    expect(within(after(nextProbeAt({ endpointId: 1, status: 'open', consecutiveFailures: 0, lastChangedAt: null, now })), CADENCE.healthy)).toBe(true);
    const changed = new Date(now.getTime() - 3_600_000);
    expect(within(after(nextProbeAt({ endpointId: 1, status: 'auth_required', consecutiveFailures: 0, lastChangedAt: changed, now })), CADENCE.afterChange)).toBe(true);
  });

  it('backs dead endpoints off exponentially up to a week', () => {
    const d = (f: number) => after(nextProbeAt({ endpointId: 7, status: 'not_found', consecutiveFailures: f, lastChangedAt: null, now }));
    expect(within(d(1), CADENCE.deadBase)).toBe(true);
    expect(within(d(2), CADENCE.deadBase * 2)).toBe(true);
    expect(within(d(20), CADENCE.deadMax)).toBe(true);
  });

  it('is deterministic per endpoint and spreads endpoints apart', () => {
    const a = nextProbeAt({ endpointId: 42, status: 'open', consecutiveFailures: 0, lastChangedAt: null, now });
    expect(nextProbeAt({ endpointId: 42, status: 'open', consecutiveFailures: 0, lastChangedAt: null, now })).toEqual(a);
    const spread = new Set(Array.from({ length: 50 }, (_, i) => nextProbeAt({ endpointId: i, status: 'open', consecutiveFailures: 0, lastChangedAt: null, now }).getTime()));
    expect(spread.size).toBeGreaterThan(40);
  });

  it('classifies failures', () => {
    expect(isFailure('dns_failed')).toBe(true);
    expect(isFailure('timeout')).toBe(true);
    expect(isFailure('auth_required')).toBe(false);
    expect(isFailure('protocol_error')).toBe(false);
  });
});
