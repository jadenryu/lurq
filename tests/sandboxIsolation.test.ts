/**
 * Running an untrusted package requires VM isolation, and the absence of it
 * must be an error rather than a silent downgrade.
 *
 * The gate is tested as a pure function so no test has to mutate the
 * environment, and the drain is tested for the property that actually protects
 * data: when isolation is missing it refuses BEFORE claiming work, because a
 * sandbox failure inside the loop counts an attempt and eventually drops the
 * queue row.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../src/db/client';
import { SandboxIsolationError, isolationGate, localSandboxAllowed } from '../src/sandbox/index';

vi.mock('../src/sandbox/index', async (orig) => ({
  ...(await orig<typeof import('../src/sandbox/index')>()),
  // The pipeline asks this before it claims anything; force the refusal.
  isolationAvailable: () => false,
}));

describe('isolationGate', () => {
  it('uses the VM driver when a key is configured', () => {
    expect(isolationGate({ hasE2BKey: true, allowLocal: false })).toEqual({ ok: true, driver: 'e2b' });
  });

  it('refuses when there is no isolation, rather than quietly running locally', () => {
    const gate = isolationGate({ hasE2BKey: false, allowLocal: false });
    expect(gate.ok).toBe(false);
    // The message has to name both the cause and the deliberate way out, or the
    // operator reads "no isolation" as "lurq is broken" and works around it.
    expect(gate.ok === false && gate.reason).toMatch(/E2B_API_KEY/);
    expect(gate.ok === false && gate.reason).toMatch(/LURQ_ALLOW_LOCAL_SANDBOX=1/);
  });

  it('allows local execution only when it was asked for explicitly', () => {
    expect(isolationGate({ hasE2BKey: false, allowLocal: true })).toEqual({ ok: true, driver: 'local' });
  });

  it('prefers the VM driver even when local is permitted', () => {
    expect(isolationGate({ hasE2BKey: true, allowLocal: true }).ok && isolationGate({ hasE2BKey: true, allowLocal: true })).toMatchObject({
      driver: 'e2b',
    });
  });
});

describe('the local opt-out', () => {
  it('is off unless set to exactly 1, so a stray value does not disable isolation', () => {
    expect(localSandboxAllowed({ LURQ_ALLOW_LOCAL_SANDBOX: '1' })).toBe(true);
    expect(localSandboxAllowed({ LURQ_ALLOW_LOCAL_SANDBOX: 'true' })).toBe(false);
    expect(localSandboxAllowed({ LURQ_ALLOW_LOCAL_SANDBOX: '0' })).toBe(false);
    expect(localSandboxAllowed({})).toBe(false);
  });
});

describe('SandboxIsolationError', () => {
  it('is identifiable, so a caller can tell a refusal from a verdict about the subject', () => {
    const err = new SandboxIsolationError('nope');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('SandboxIsolationError');
  });
});

describe('the MCP drain with no isolation', () => {
  it('returns an empty summary without reaching the database', async () => {
    const { drainMcpQueue } = await import('../src/pipeline/mcp');
    // A null db is the assertion: any queue read would throw on it, so a clean
    // zeroed summary proves nothing was claimed and nothing was dropped.
    const summary = await drainMcpQueue(null as unknown as Database, {});
    expect(summary).toMatchObject({ drained: 0, stored: 0, failed: 0, backfilled: 0 });
  });
});
