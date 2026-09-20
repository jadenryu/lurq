/**
 * Live scans against real servers: stdio fixtures spawned as child processes,
 * and an in-process Streamable HTTP server. Nothing here is mocked at the
 * transport, because the failure modes worth testing (a server that logs to
 * stdout, crashes on boot, never answers, sends garbage) only exist on a wire.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ServerSpec } from '../src/mcpScan/config';
import { scanServer, scanServers } from '../src/mcpScan/connect';

const FIXTURES = join(__dirname, 'fixtures', 'mcpServers');

function spec(over: Partial<ServerSpec> = {}): ServerSpec {
  return {
    alias: 'fx',
    transport: 'stdio',
    command: process.execPath,
    args: [join(FIXTURES, 'good.mjs')],
    env: {},
    cwd: null,
    url: null,
    headers: {},
    kind: 'local',
    registry: 'local',
    packageName: null,
    pinnedVersion: null,
    serverKey: 'local:fx',
    configFingerprint: 'fp',
    scope: 'user',
    trusted: true,
    trustReason: 'your own configuration',
    unresolved: [],
    disabled: false,
    secrets: [],
    sources: [],
    ...over,
  };
}

const fast = { connectTimeoutMs: 15_000, requestTimeoutMs: 10_000, serverBudgetMs: 30_000 };

describe('stdio', () => {
  it('reads the whole contract of a well-behaved server', async () => {
    const r = await scanServer(spec(), fast);
    expect(r).toMatchObject({ status: 'ok', transportUsed: 'stdio', error: null });
    const s = r.snapshot!;
    expect(s.serverInfo).toMatchObject({ name: 'fixture-good', version: '1.2.3' });
    expect(s.instructions).toBe('Call search before fetch.');
    expect(s.tools.map((t) => t.name).sort()).toEqual(['delete_file', 'search']);
    expect(s.tools.find((t) => t.name === 'search')!.annotations).toEqual({ readOnlyHint: true });
    expect(s.prompts).toEqual([
      expect.objectContaining({
        name: 'summarize',
        arguments: [expect.objectContaining({ name: 'text', required: true })],
      }),
    ]);
    expect(s.resourceTemplates).toEqual([
      expect.objectContaining({ name: 'doc', uriTemplate: 'doc://{id}' }),
    ]);
    expect(s.capabilities).toMatchObject({ tools: true, prompts: true, resources: true });
    expect(s.issues).toEqual([]);
  });

  // Many real servers log a banner to stdout. The scan still reads them, and
  // says so, because some clients will not.
  it('survives a server that writes logs to stdout, and flags it', async () => {
    const r = await scanServer(spec({ env: { FIXTURE_NOISE: '1' } }), fast);
    expect(r.status).toBe('ok');
    expect(r.snapshot!.tools).toHaveLength(2);
    expect(r.snapshot!.issues).toEqual([expect.objectContaining({ kind: 'stdout_noise' })]);
  });

  it('calls a boot-time "X is required" crash missing config, not a broken server', async () => {
    const r = await scanServer(spec({ env: { FIXTURE_REQUIRE: 'API_TOKEN' } }), fast);
    expect(r.status).toBe('needs_config');
    expect(r.error).toMatch(/API_TOKEN/);
    expect(r.hint).toMatch(/API_TOKEN/);
    const fixed = await scanServer(
      spec({ env: { FIXTURE_REQUIRE: 'API_TOKEN', API_TOKEN: 'x' } }),
      fast,
    );
    expect(fixed.status).toBe('ok');
  });

  it('times out a server that never answers, within the deadline', async () => {
    const started = Date.now();
    const r = await scanServer(spec({ env: { FIXTURE_HANG: '1' } }), {
      ...fast,
      connectTimeoutMs: 1_500,
    });
    expect(r.status).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(12_000);
  });

  it('names a command that does not exist', async () => {
    const r = await scanServer(spec({ command: 'lurq-definitely-not-a-command', args: [] }), fast);
    expect(r.status).toBe('spawn_failed');
    expect(r.error).toMatch(/command not found: lurq-definitely-not-a-command/);
  });

  it('never keeps a configured secret, even when the server prints it', async () => {
    const secret = 'sekret-value-1234567890';
    const r = await scanServer(spec({ env: { FIXTURE_ECHO: secret }, secrets: [secret] }), fast);
    expect(r.status).toBe('ok');
    expect(r.stderrTail).toMatch(/using token \[redacted\]/);
    expect(JSON.stringify(r)).not.toContain(secret);
  });

  it('reads what it can from a malformed server and records the rest as issues', async () => {
    const r = await scanServer(spec({ args: [join(FIXTURES, 'malformed.mjs')] }), fast);
    // Prompts failed and the cursor looped, so the read is partial — but the
    // tools that were well-formed are all there.
    expect(r.status).toBe('partial');
    const s = r.snapshot!;
    expect(s.tools.map((t) => t.name).sort()).toEqual(['deep', 'ok', 'second']);
    expect(s.tools.find((t) => t.name === 'ok')!.description).toBeUndefined(); // first copy wins
    expect(s.tools.find((t) => t.name === 'deep')!.inputSchema).toEqual({
      'x-lurq-omitted': expect.stringMatching(/deeper than/),
    });
    // A string "yes" is not a boolean; only the well-typed hint survives.
    expect(s.tools.find((t) => t.name === 'second')!.annotations).toEqual({
      destructiveHint: false,
    });
    const kinds = s.issues.map((i) => `${i.list}:${i.kind}`).sort();
    expect(kinds).toEqual(
      expect.arrayContaining([
        'prompts:list_failed',
        'tools:duplicate',
        'tools:malformed',
        'tools:oversized',
        'tools:truncated',
      ]),
    );
    expect(s.issues.filter((i) => i.kind === 'malformed')).toHaveLength(2);
  });
});

describe('servers that must not be launched', () => {
  it('skips untrusted, disabled and unconfigured servers without spawning', async () => {
    const never = { command: 'lurq-definitely-not-a-command' };
    const untrusted = await scanServer(
      spec({ ...never, trusted: false, trustReason: 'not approved' }),
    );
    expect(untrusted).toMatchObject({ status: 'untrusted', hint: 'not approved' });
    const disabled = await scanServer(spec({ ...never, disabled: true }));
    expect(disabled.status).toBe('disabled');
    const unset = await scanServer(spec({ ...never, unresolved: ['GITHUB_TOKEN'] }));
    expect(unset).toMatchObject({ status: 'needs_config', error: 'no value for GITHUB_TOKEN' });
  });
});

describe('streamable HTTP', () => {
  let http: Server;
  let base = '';
  const TOKEN = 'good-token-1234567890';

  beforeAll(async () => {
    http = createServer(async (req, res) => {
      if (!req.url?.startsWith('/mcp')) {
        res.writeHead(404).end('not found');
        return;
      }
      if (req.headers.authorization !== `Bearer ${TOKEN}`) {
        res.writeHead(401).end();
        return;
      }
      const server = new McpServer({ name: 'fixture-http', version: '2.0.0' });
      server.registerTool(
        'ping',
        { description: 'Ping', inputSchema: { msg: z.string() } },
        async () => ({
          content: [],
        }),
      );
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    });
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => http.close(() => resolve())));

  const remote = (over: Partial<ServerSpec>) =>
    spec({
      transport: 'http',
      command: null,
      args: [],
      registry: 'remote',
      kind: 'remote',
      ...over,
    });

  it('reads a remote server with the headers from the config', async () => {
    const r = await scanServer(
      remote({
        url: `${base}/mcp`,
        headers: { Authorization: `Bearer ${TOKEN}` },
        secrets: [TOKEN],
      }),
      fast,
    );
    expect(r).toMatchObject({ status: 'ok', transportUsed: 'http' });
    expect(r.snapshot!.tools.map((t) => t.name)).toEqual(['ping']);
  });

  it('reports a rejected credential as auth_required', async () => {
    const r = await scanServer(
      remote({ url: `${base}/mcp`, headers: { Authorization: 'Bearer wrong-token-123' } }),
      fast,
    );
    expect(r.status).toBe('auth_required');
    expect(r.hint).toBeTruthy();
  });

  // `auto` tries SSE when Streamable HTTP is refused; when both 404, it is unreachable.
  it('falls back to SSE on an auto url and reports unreachable when nothing answers', async () => {
    const r = await scanServer(remote({ transport: 'auto', url: `${base}/nothing-here` }), fast);
    expect(r.status).toBe('unreachable');
    expect(r.transportUsed).toBe('sse');
  });

  it('reports a refused connection as unreachable', async () => {
    // A port that was free a moment ago: closed, so the connect is refused.
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const port = (probe.address() as AddressInfo).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    const r = await scanServer(remote({ url: `http://127.0.0.1:${port}/mcp` }), fast);
    expect(r.status).toBe('unreachable');
    expect(r.error).toMatch(/ECONNREFUSED|fetch failed/);
  });

  it('reports a fetch-blocked port as unreachable, not a protocol fault', async () => {
    const r = await scanServer(remote({ url: 'http://127.0.0.1:9/mcp' }), fast);
    expect(r.status).toBe('unreachable');
  });
});

describe('scanServers', () => {
  it('scans concurrently and reports each result as it lands', async () => {
    const seen: string[] = [];
    const results = await scanServers(
      [
        spec({ alias: 'a' }),
        spec({ alias: 'b', disabled: true }),
        spec({ alias: 'c', env: { FIXTURE_NOISE: '1' } }),
      ],
      { ...fast, concurrency: 2, onResult: (s) => seen.push(s.alias) },
    );
    expect(results.map((r) => [r.alias, r.status])).toEqual([
      ['a', 'ok'],
      ['b', 'disabled'],
      ['c', 'ok'],
    ]);
    expect(seen.sort()).toEqual(['a', 'b', 'c']);
  });

  it('stops launching once cancelled', async () => {
    const ctl = new AbortController();
    const pending = scanServer(spec({ env: { FIXTURE_HANG: '1' } }), {
      ...fast,
      signal: ctl.signal,
    });
    setTimeout(() => ctl.abort(), 300);
    expect((await pending).status).toBe('cancelled');
  });
});
