import { describe, it, expect } from 'vitest';
import {
  mcpServerOracle,
  parseProbeOutput,
  probeScript,
  probeMcpServer,
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
  pages: 1,
  truncated: false,
  tools: [
    {
      name: 'search',
      description: 'search things',
      inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
    },
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
  it('embeds the package name and speaks the handshake in order', () => {
    const s = probeScript('some-mcp');
    expect(s).toContain("method: 'initialize'");
    expect(s).toContain('notifications/initialized');
    expect(s).toContain('tools/list');
    // the name must be JSON-embedded, never concatenated into a shell line
    expect(s).toContain('"some-mcp"');
  });

  // A published server's bin name is routinely not its package name
  // (@modelcontextprotocol/server-filesystem ships `mcp-server-filesystem`), and
  // guessing wrong looks exactly like a server that fails to start.
  it('resolves the entry point from the installed manifest', () => {
    const s = probeScript('some-mcp');
    expect(s).toContain('package.json');
    expect(s).toContain('manifest.bin');
  });

  // `tools/list` is paginated. Reading only the first page and diffing it
  // against a full read reports every tool on the undrained pages as removed.
  it('drains every page of tools/list', () => {
    const s = probeScript('some-mcp');
    expect(s).toContain('nextCursor');
    expect(s).toContain('cursor: cursor');
  });

  /**
   * The truncation bug, pinned.
   *
   * `process.exit()` abandons whatever has not drained from a pipe-backed
   * stdout, so a payload larger than the 8 KiB pipe buffer was cut mid-JSON and
   * the caller recorded a perfectly healthy server as unreachable. Only the
   * write callback makes the exit safe, and the generated script must carry an
   * ESCAPED newline — an unescaped one terminates the string literal and the
   * whole probe fails to parse.
   */
  it('flushes stdout before exiting', () => {
    const s = probeScript('some-mcp');
    expect(s).toContain('process.stdout.write');
    // The newline must survive as an ESCAPE, not as a real line break: a raw
    // newline here terminates the string literal and the whole probe stops
    // parsing (which is exactly how the flush fix first shipped).
    expect(s).toContain("process.stdout.write(JSON.stringify(o) + '\\n'");
    expect(s).not.toContain('console.log(JSON.stringify(o))');
  });

  it('generates a syntactically valid script', () => {
    // new Function parses without executing: a broken escape in the template
    // (the exact way the flush fix first shipped) fails here rather than
    // silently producing an empty probe at runtime.
    expect(() => new Function(probeScript('some-mcp'))).not.toThrow();
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

  /**
   * A partially-drained tool list is a MEASUREMENT failure, not a finding.
   * Recording it as a successful read lets the next full read diff against it
   * and report every tool on the pages we never asked for as removed.
   */
  it('records a truncated tool list as unverifiable, never as a surface', async () => {
    const truncated = JSON.stringify({
      ok: true,
      stage: 'done',
      tools: [{ name: 'a' }],
      pages: 50,
      truncated: true,
    });
    const sb = fakeSandbox(async () => ({ exitCode: 0, stdout: truncated, stderr: '' }));
    const res = await mcpServerOracle.run(TARGET, ENV, sb);

    expect(res.observations[0]!.verdict).toBe('unverifiable');
    expect(res.observations[0]!.evidence).toMatch(/incomplete/);
    expect(res.discovered ?? []).toEqual([]);
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

/**
 * The launch ladder, measured rather than guessed.
 *
 * Across 65 servers whose probe failed, 35% printed a usage banner because the
 * bin is a multi-command CLI where MCP is one verb, and 28% exited on a missing
 * credential. Neither is a broken server; both were reported as one.
 */
describe('launch ladder', () => {
  const okProbeWith = (n: number) =>
    JSON.stringify({
      ok: true,
      stage: 'done',
      pages: 1,
      truncated: false,
      tools: Array.from({ length: n }, (_, i) => ({ name: `t${i}` })),
    });
  const usageBanner = JSON.stringify({
    ok: false,
    stage: 'spawn',
    error: 'exited 1: Usage: thing <command>',
  });

  it('costs a healthy server exactly one attempt', async () => {
    let calls = 0;
    const sb = fakeSandbox(async () => {
      calls++;
      return { exitCode: 0, stdout: okProbeWith(3), stderr: '' };
    });
    const r = await probeMcpServer(sb, 'some-mcp', null);
    expect(r.probe?.ok).toBe(true);
    expect(calls).toBe(1);
    expect(r.launchedWith).toEqual([]);
  });

  it('recovers a server whose bin needs a subcommand', async () => {
    const sb = fakeSandbox(async (cmd) => ({
      exitCode: 0,
      // Only the invocation carrying the `mcp` verb answers.
      stdout: cmd.includes('"mcp"') ? okProbeWith(9) : usageBanner,
      stderr: '',
    }));
    const r = await probeMcpServer(sb, 'some-mcp', null);
    expect(r.probe?.ok).toBe(true);
    expect(r.launchedWith).toEqual(['mcp']);
  });

  it('prefers the manifest-declared arguments over guessing', async () => {
    const seen: string[] = [];
    const sb = fakeSandbox(async (cmd) => {
      seen.push(cmd);
      return { exitCode: 0, stdout: okProbeWith(2), stderr: '' };
    });
    const r = await probeMcpServer(sb, 'some-mcp', null, { args: ['serve'] });
    expect(r.launchedWith).toEqual(['serve']);
    expect(seen).toHaveLength(1);
  });

  // A sandbox outage is not evidence about any server, so multiplying it across
  // four launch attempts would turn one outage into four false negatives.
  it('stops the ladder when the sandbox itself fails', async () => {
    let calls = 0;
    const sb = fakeSandbox(async () => {
      calls++;
      throw new Error('E2B down');
    });
    await expect(probeMcpServer(sb, 'some-mcp', null)).rejects.toThrow(/sandbox failure/);
    expect(calls).toBe(1);
  });

  it('gives up honestly when no lever works', async () => {
    const sb = fakeSandbox(async () => ({ exitCode: 1, stdout: usageBanner, stderr: '' }));
    const r = await probeMcpServer(sb, 'some-mcp', null);
    expect(r.probe?.ok).toBe(false);
    expect(r.launchedWith).toEqual([]);
  });
});

describe('placeholder configuration', () => {
  it('embeds the placeholder env in the script it ships to the sandbox', () => {
    const s = probeScript('some-mcp', [], {
      SOME_API_KEY: 'lurq-placeholder-not-a-real-credential',
    });
    expect(s).toContain('SOME_API_KEY');
    expect(s).toContain('EXTRA_ENV');
    // Merged over the sandbox's own environment, not replacing it — the server
    // still needs PATH and friends to start at all.
    expect(s).toContain('Object.assign({}, process.env, EXTRA_ENV)');
  });

  it('places launch arguments after the resolved entry point', () => {
    const s = probeScript('some-mcp', ['mcp']);
    expect(s).toContain('args.concat(EXTRA_ARGS)');
    expect(s).toContain('["mcp"]');
  });

  it('still generates a valid script with both levers applied', () => {
    expect(() => new Function(probeScript('some-mcp', ['mcp'], { A_B: 'x' }))).not.toThrow();
  });
});
