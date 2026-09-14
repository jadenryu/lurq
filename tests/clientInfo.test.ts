/**
 * Pinned: agent labels from a client are reduced to a plain token or dropped,
 * and the handshake's client name is read only from an `initialize`.
 */
import { describe, expect, it } from 'vitest';
import { agentClient, initializeInfo } from '../src/mcp/clientInfo';

describe('agentClient', () => {
  it('keeps a plain agent id, lowercased', () => {
    expect(agentClient('claude-code')).toBe('claude-code');
    expect(agentClient(' Cursor ')).toBe('cursor');
    expect(agentClient(['codex', 'other'])).toBe('codex');
  });

  it('drops anything that is not a short plain token', () => {
    expect(agentClient(undefined)).toBeNull();
    expect(agentClient('')).toBeNull();
    expect(agentClient('cursor; drop table')).toBeNull();
    expect(agentClient('a'.repeat(41))).toBeNull();
    expect(agentClient(42)).toBeNull();
  });
});

describe('initializeInfo', () => {
  it('reads the client name and version from an initialize, alone or in a batch', () => {
    const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'claude-code', version: '2.1.0' } } };
    expect(initializeInfo(init)).toEqual({ name: 'claude-code', version: '2.1.0' });
    expect(initializeInfo([{ method: 'ping' }, init])).toEqual({ name: 'claude-code', version: '2.1.0' });
  });

  it('is null for anything but an initialize, and clips what it keeps', () => {
    expect(initializeInfo({ method: 'tools/call' })).toBeNull();
    expect(initializeInfo(null)).toBeNull();
    const long = initializeInfo({ method: 'initialize', params: { clientInfo: { name: 'x'.repeat(100) } } });
    expect(long).toEqual({ name: 'x'.repeat(64), version: null });
  });
});
