import { describe, expect, it } from 'vitest';
import { emptySnapshot, type Snapshot } from '../src/mcpScan/snapshot';
import { authHash, contractRow, describeAuthChange, detectChanges } from '../src/remoteProbe/changes';
import { laneByHost } from '../src/remoteProbe/drain';
import type { AuthProfile, OAuthProfile, ProbeResult } from '../src/remoteProbe/types';

const oauth = (over: Partial<OAuthProfile> = {}): OAuthProfile => ({
  resourceMetadataUrl: 'https://x.dev/.well-known/oauth-protected-resource',
  resourceMetadataVia: 'well_known_root',
  resource: 'https://x.dev',
  authorizationServers: ['https://auth.x.dev'],
  scopesSupported: ['read'],
  challengeScope: null,
  issuer: 'https://auth.x.dev',
  asMetadataUrl: 'https://auth.x.dev/.well-known/oauth-authorization-server',
  cimd: true,
  dcr: true,
  pkceS256: true,
  issParameter: true,
  ...over,
});
const auth = (over: Partial<AuthProfile> = {}): AuthProfile => ({ mode: 'oauth', challengeStatus: 401, oauth: oauth(), declaredHeaders: [], ...over });

function snap(tools: Snapshot['tools']): Snapshot {
  return { ...emptySnapshot(), tools };
}
const TOOL = (name: string, required: string[] = ['q']) => ({
  name,
  description: `${name} things`,
  inputSchema: { type: 'object', properties: { q: { type: 'string' }, limit: { type: 'number' } }, required },
  annotations: { readOnlyHint: true },
});

const result = (over: Partial<ProbeResult> = {}): ProbeResult => ({
  url: 'https://x.dev/mcp',
  status: 'open',
  httpStatus: 200,
  transport: 'streamable-http',
  protocolMode: 'stateless',
  protocolVersion: '2026-07-28',
  serverName: null,
  serverVersion: null,
  auth: { mode: 'none', challengeStatus: null, oauth: null, declaredHeaders: [] },
  violations: [],
  snapshot: null,
  error: null,
  latencyMs: 100,
  finalUrl: null,
  ...over,
});

describe('authHash', () => {
  it('is stable across ordering and ignores what the registry declares', () => {
    const a = auth({ oauth: oauth({ authorizationServers: ['b', 'a'], scopesSupported: ['w', 'r'] }) });
    const b = auth({ oauth: oauth({ authorizationServers: ['a', 'b'], scopesSupported: ['r', 'w'] }), declaredHeaders: [{ name: 'X', required: true, secret: true, description: null }] });
    expect(authHash(a)).toBe(authHash(b));
    expect(authHash(auth({ oauth: oauth({ cimd: false }) }))).not.toBe(authHash(a));
  });

  it('is null when nothing was learned, so an outage is never an auth change', () => {
    expect(authHash({ mode: 'unknown', challengeStatus: null, oauth: null, declaredHeaders: [] })).toBeNull();
  });
});

describe('contractRow', () => {
  it('addresses the same contract identically and analyses it', () => {
    const a = contractRow(snap([TOOL('search'), TOOL('fetch')]));
    const b = contractRow(snap([TOOL('fetch'), TOOL('search')]));
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.contractHash).toBe(b.contractHash);
    expect(a).toMatchObject({ toolCount: 2, analyzerVersion: expect.any(String) });
    expect(a.analysis).toMatchObject({ stats: expect.objectContaining({ tools: 2 }) });
  });
});

describe('describeAuthChange', () => {
  it('ranks a lost registration method and a new issuer as high', () => {
    expect(describeAuthChange(auth(), auth({ oauth: oauth({ cimd: false }) }))).toMatchObject({ severity: 'high', summary: expect.stringMatching(/Client ID Metadata/) });
    expect(describeAuthChange(auth(), auth({ oauth: oauth({ issuer: 'https://new.dev' }) })).summary).toMatch(/registrations must be redone/);
    expect(describeAuthChange(auth(), auth({ oauth: oauth({ pkceS256: false }) })).severity).toBe('high');
  });

  it('ranks gains low and mode changes by who they break', () => {
    expect(describeAuthChange(auth({ oauth: oauth({ dcr: false }) }), auth())).toMatchObject({ severity: 'low', summary: expect.stringMatching(/now offers Dynamic/) });
    expect(describeAuthChange({ ...auth(), mode: 'none', oauth: null }, auth()).severity).toBe('high');
    expect(describeAuthChange(auth(), { ...auth(), mode: 'static', oauth: null }).summary).toMatch(/can no longer sign in/);
  });
});

describe('detectChanges', () => {
  it('reports an endpoint going dark and coming back, but not a timeout flap', () => {
    const dark = detectChanges({ status: 'open', contentHash: 'c', authHash: 'a', auth: null, contract: null }, { result: result({ status: 'not_found' }), contentHash: null, authHash: null }, 'srv');
    expect(dark).toEqual([expect.objectContaining({ kind: 'status', severity: 'high', fromKey: 'open', toKey: 'not_found' })]);
    const back = detectChanges({ status: 'dns_failed', contentHash: null, authHash: null, auth: null, contract: null }, { result: result(), contentHash: 'c', authHash: 'a' }, 'srv');
    expect(back).toEqual([expect.objectContaining({ kind: 'status', severity: 'low' })]);
    expect(detectChanges({ status: 'open', contentHash: 'c', authHash: 'a', auth: null, contract: null }, { result: result({ status: 'timeout' }), contentHash: null, authHash: null }, 'srv')).toEqual([]);
  });

  it('scores a contract change with the shared snapshot diff', () => {
    const before = snap([TOOL('search'), TOOL('delete_all')]);
    const after = snap([TOOL('search', ['q', 'limit'])]);
    const changes = detectChanges(
      { status: 'open', contentHash: 'c1', authHash: 'a', auth: null, contract: before },
      { result: result({ snapshot: after }), contentHash: 'c2', authHash: 'a' },
      'srv',
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: 'contract', fromKey: 'c1', toKey: 'c2' });
    expect(['moderate', 'high', 'critical']).toContain(changes[0]!.severity);
    expect(changes[0]!.summary).toMatch(/delete_all|removed|required/i);
  });

  it('reports an auth change only when both sides were established', () => {
    const prev = { status: 'auth_required' as const, contentHash: null, authHash: 'a1', auth: auth(), contract: null };
    const next = auth({ oauth: oauth({ dcr: false }) });
    expect(detectChanges(prev, { result: result({ status: 'auth_required', auth: next }), contentHash: null, authHash: 'a2' }, 'srv')).toEqual([
      expect.objectContaining({ kind: 'auth', severity: 'high' }),
    ]);
    expect(detectChanges({ ...prev, authHash: null }, { result: result({ status: 'auth_required', auth: next }), contentHash: null, authHash: 'a2' }, 'srv')).toEqual([]);
  });
});

describe('laneByHost', () => {
  const ep = (id: number, host: string) => ({ id, url: `https://${host}/${id}`, host, transport: 'streamable-http', lastStatus: null, lastContentHash: null, lastAuthHash: null, auth: null, consecutiveFailures: 0, lastChangedAt: null });
  it('never gives one host more than perHost lanes, and keeps every endpoint', () => {
    const eps = [...Array.from({ length: 7 }, (_, i) => ep(i, 'workers.dev')), ep(100, 'a.dev'), ep(101, 'b.dev')];
    const lanes = laneByHost(eps, 2);
    expect(lanes.filter((l) => l[0]!.host === 'workers.dev')).toHaveLength(2);
    expect(lanes.flat().map((e) => e.id).sort((a, b) => a - b)).toEqual(eps.map((e) => e.id).sort((a, b) => a - b));
    expect(lanes.every((l) => new Set(l.map((e) => e.host)).size === 1)).toBe(true);
  });
});
