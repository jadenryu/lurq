import { describe, it, expect } from 'vitest';
import {
  mcpServerOracle,
  parseProbeOutput,
  probeScript,
  shellQuote,
} from '../src/graph/oracles/mcpServer';
import { applyTtl, fingerprint } from '../src/db/graph';
import type { Environment, EntityRef } from '../src/graph/types';
import type {
  ExecOptions,
  ExecResult,
  Sandbox,
  SandboxResult,
  SandboxSetResult,
} from '../src/sandbox/types';

const ENV: Environment = {
  os: 'linux',
  arch: 'x64',
  runtime: 'node',
  runtimeVer: '20.11.0',
  resolver: 'npm@10',
};

const TARGET: EntityRef = { kind: 'mcp_server', namespace: 'npm', name: 'some-mcp', version: null };

/** Sandbox stub whose exec() returns canned output (or throws, for the infra case). */
function fakeSandbox(exec: (cmd: string, opts?: ExecOptions) => Promise<ExecResult>): Sandbox {
  return {
    name: 'fake',
    exec,
    verify: async () => ({}) as SandboxResult,
    verifySet: async () => ({}) as SandboxSetResult,
    getRuntimeInfo: async () => ({ nodeVersion: 'v20.11.0', npmVersion: '10.2.4' }),
  };
}

const okProbe = JSON.stringify({
  ok: true,
  stage: 'done',
  serverInfo: { name: 'some-mcp', version: '1.2.0' },
  protocolVersion: '2025-11-25',
  tools: [
    { name: 'search', description: 'search things' },
    { name: 'fetch', description: 'fetch a thing' },
  ],
});

describe('parseProbeOutput', () => {
  it('finds the probe line even when the server logged noise to stdout', () => {
    const stdout = `Starting server...\nlistening on stdio\n${okProbe}\n`;
    expect(parseProbeOutput(stdout)?.tools).toHaveLength(2);
  });

  it('ignores JSON on stdout that is not the probe result', () => {
    const stdout = `{"level":"info","msg":"booting"}\n${okProbe}\n`;
    expect(parseProbeOutput(stdout)?.ok).toBe(true);
  });

  it('returns null when the probe never printed', () => {
    expect(parseProbeOutput('command not found\n')).toBeNull();
  });
});

describe('probeScript', () => {
  it('embeds the launch command and speaks the handshake in order', () => {
    const s = probeScript('npx', ['--no-install', 'some-mcp']);
    expect(s).toContain("method: 'initialize'");
    expect(s).toContain('notifications/initialized');
    expect(s).toContain('tools/list');
    // args must be JSON-embedded, never string-concatenated into a shell line
    expect(s).toContain('["--no-install","some-mcp"]');
  });
});

describe('shellQuote', () => {
  it('survives a script containing single quotes', () => {
    expect(shellQuote("a'b")).toBe(`'a'\\''b'`);
  });
});

describe('mcpServerOracle.run', () => {
  it('records verified_true plus one provides edge per listed tool', async () => {
    const sb = fakeSandbox(async () => ({ exitCode: 0, stdout: okProbe, stderr: '' }));
    const res = await mcpServerOracle.run(TARGET, ENV, sb);

    const init = res.observations.find((o) => o.relation === 'initializes');
    expect(init?.verdict).toBe('verified_true');

    const provides = res.observations.filter((o) => o.relation === 'provides');
    expect(provides).toHaveLength(2);
    expect(provides.every((o) => o.verdict === 'verified_true')).toBe(true);
    expect(res.discovered?.map((d) => d.name)).toEqual(['some-mcp#search', 'some-mcp#fetch']);
    expect(res.discovered?.every((d) => d.kind === 'mcp_tool')).toBe(true);
  });

  it('installs the target package before probing it', async () => {
    let seen: ExecOptions | undefined;
    const sb = fakeSandbox(async (_cmd, opts) => {
      seen = opts;
      return { exitCode: 0, stdout: okProbe, stderr: '' };
    });
    await mcpServerOracle.run({ ...TARGET, version: '2.0.0' }, ENV, sb);
    expect(seen?.install).toEqual([{ name: 'some-mcp', version: '2.0.0' }]);
  });

  it('records verified_false with evidence when the handshake fails', async () => {
    const bad = JSON.stringify({ ok: false, stage: 'initialize', error: 'timeout' });
    const sb = fakeSandbox(async () => ({ exitCode: 1, stdout: bad, stderr: '' }));
    const res = await mcpServerOracle.run(TARGET, ENV, sb);

    expect(res.observations).toHaveLength(1);
    expect(res.observations[0]!.verdict).toBe('verified_false');
    expect(res.observations[0]!.evidence).toContain('timeout');
  });

  it('records verified_false when the probe produced no output at all', async () => {
    const sb = fakeSandbox(async () => ({ exitCode: 127, stdout: '', stderr: 'npx: not found' }));
    const res = await mcpServerOracle.run(TARGET, ENV, sb);
    expect(res.observations[0]!.verdict).toBe('verified_false');
    expect(res.observations[0]!.evidence).toContain('npx: not found');
  });

  // The single most important invariant in the spec (§4.1, §6.1): a sandbox
  // failure is NOT evidence about the subject. It must surface as a throw so the
  // runner records `unverifiable` — never a false `verified_false`.
  it('throws instead of condemning the subject when the sandbox itself fails', async () => {
    const sb = fakeSandbox(async () => {
      throw new Error('E2B: VM allocation timed out');
    });
    await expect(mcpServerOracle.run(TARGET, ENV, sb)).rejects.toThrow(/sandbox failure/);
  });
});

describe('applyTtl', () => {
  const now = Date.UTC(2026, 7, 5, 12, 0, 0);
  const hoursAgo = (h: number) => new Date(now - h * 3_600_000);

  it('keeps a fresh verdict intact', () => {
    expect(applyTtl('verified_true', hoursAgo(2), 24, now)).toBe('verified_true');
    expect(applyTtl('verified_false', hoursAgo(23.9), 24, now)).toBe('verified_false');
  });

  it('downgrades an expired verdict to stale', () => {
    expect(applyTtl('verified_true', hoursAgo(25), 24, now)).toBe('stale');
    expect(applyTtl('verified_false', hoursAgo(999), 24, now)).toBe('stale');
  });

  // "we have not checked" and "we could not check" never expire into something
  // that reads as a real finding — that collapse is the failure mode §4.1 warns
  // about, where an agent trusts a hole in the graph.
  it('never ages unknown or unverifiable into a finding', () => {
    expect(applyTtl('unknown', hoursAgo(10_000), 24, now)).toBe('unknown');
    expect(applyTtl('unverifiable', hoursAgo(10_000), 24, now)).toBe('unverifiable');
  });
});

describe('environment fingerprint', () => {
  it('is stable for the same runtime and distinct across runtimes', () => {
    expect(fingerprint(ENV)).toBe(fingerprint({ ...ENV }));
    expect(fingerprint(ENV)).not.toBe(fingerprint({ ...ENV, runtimeVer: '22.0.0' }));
    // resolver is part of the identity: npm and pnpm resolve differently
    expect(fingerprint(ENV)).not.toBe(fingerprint({ ...ENV, resolver: 'pnpm@9' }));
  });
});
