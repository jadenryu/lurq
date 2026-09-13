import { describe, it, expect } from 'vitest';
import { DISCOVERY_METHODS, isAnonymousDiscovery } from '../src/mcp/http';

const rpc = (method: string, id: number | null = 1) => ({ jsonrpc: '2.0', method, ...(id === null ? {} : { id }) });

// Registries and directories list a server's tools without anyone's key. The
// rule that lets them has to stay exactly that narrow: describing lurq is free,
// running it is not.
describe('keyless MCP discovery', () => {
  it('lets the handshake and the list calls through without a key', () => {
    for (const method of ['initialize', 'ping', 'tools/list', 'prompts/list', 'resources/list', 'resources/templates/list']) {
      expect(isAnonymousDiscovery(undefined, rpc(method))).toBe(true);
    }
    expect(isAnonymousDiscovery(undefined, rpc('notifications/initialized', null))).toBe(true);
  });

  it('accepts a batch only when every message in it is discovery', () => {
    expect(isAnonymousDiscovery(undefined, [rpc('initialize'), rpc('tools/list', 2)])).toBe(true);
    // A tool call hidden in a batch must not ride along.
    expect(isAnonymousDiscovery(undefined, [rpc('tools/list'), rpc('tools/call', 2)])).toBe(false);
  });

  it('never runs a tool without a key', () => {
    expect(isAnonymousDiscovery(undefined, rpc('tools/call'))).toBe(false);
    expect(DISCOVERY_METHODS.has('tools/call')).toBe(false);
  });

  // A client that sent a header meant to authenticate; it gets the precise
  // "missing" or "invalid" error, not a quietly anonymous session.
  it('takes the authenticated path whenever an Authorization header is present', () => {
    expect(isAnonymousDiscovery('Bearer lurq_bad', rpc('tools/list'))).toBe(false);
    expect(isAnonymousDiscovery('', rpc('tools/list'))).toBe(false);
  });

  it('rejects bodies that are not JSON-RPC requests', () => {
    expect(isAnonymousDiscovery(undefined, undefined)).toBe(false);
    expect(isAnonymousDiscovery(undefined, null)).toBe(false);
    expect(isAnonymousDiscovery(undefined, [])).toBe(false);
    expect(isAnonymousDiscovery(undefined, { jsonrpc: '2.0', id: 1 })).toBe(false);
    expect(isAnonymousDiscovery(undefined, rpc('initialize ') )).toBe(false);
  });
});
