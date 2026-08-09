/**
 * The hosted-CLI path: a machine with an API key and no database.
 *
 * Two things are load-bearing here and neither is obvious from reading the code:
 * that `callTool` unwraps the MCP envelope into the same object a local handler
 * would have returned, and that a stored key beats a stray DATABASE_URL from the
 * user's own project `.env`. The first is asserted against a real HTTP server
 * rather than a mocked fetch, because the failure modes we care about (a missing
 * Accept header, an SSE body) live in the transport.
 */
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { indexSource } from '../src/cli/commands';
import { runningFromNpx, runSetup } from '../src/cli/install';
import { callTool, RemoteError } from '../src/cli/remote';
import { loadEnv } from '../src/core/config';
import { DEFAULT_ENDPOINT } from '../src/core/constants';
import { clearUserConfig, readUserConfig, writeUserConfig } from '../src/core/userConfig';

/** What the next request should answer with. */
let reply: { status?: number; contentType?: string; body: string };
let lastRequest: { headers: Record<string, string | undefined>; body: any };
let baseUrl: string;
let server: Server;

/** Options for a call against the stub, resolved after `beforeAll` has a port. */
const stub = () => ({ url: baseUrl, apiKey: 'lurq_live_test' });

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      lastRequest = { headers: req.headers as Record<string, string>, body: JSON.parse(raw) };
      res.writeHead(reply.status ?? 200, {
        'Content-Type': reply.contentType ?? 'application/json',
      });
      res.end(reply.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/mcp`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

/** An MCP tool result: one JSON text block, exactly what mcp/server.ts sends. */
const toolResult = (obj: unknown, isError = false) =>
  JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    result: { content: [{ type: 'text', text: JSON.stringify(obj) }], isError },
  });

describe('callTool', () => {
  it('unwraps the MCP text block into the handler result', async () => {
    reply = { body: toolResult({ candidates: [{ name: 'zod', healthScore: 91 }] }) };
    const res = await callTool<{ candidates: { name: string }[] }>(
      'recommend',
      { need: 'validation' },
      stub(),
    );
    expect(res.candidates[0]!.name).toBe('zod');
  });

  it('sends a bare tools/call with the Bearer key and both Accept types', async () => {
    reply = { body: toolResult({ ok: true }) };
    await callTool('verify', { package: 'zod' }, stub());

    // No `initialize` handshake: the hosted route is stateless, and needing one
    // would make every CLI call two round trips.
    expect(lastRequest.body).toMatchObject({
      method: 'tools/call',
      params: { name: 'verify', arguments: { package: 'zod' } },
    });
    expect(lastRequest.headers.authorization).toBe('Bearer lurq_live_test');
    // The streamable-HTTP transport rejects a request that doesn't accept both,
    // even when it answers with plain JSON.
    expect(lastRequest.headers.accept).toContain('application/json');
    expect(lastRequest.headers.accept).toContain('text/event-stream');
  });

  it('accepts an endpoint configured with or without the /mcp suffix', async () => {
    reply = { body: toolResult({ ok: true }) };
    await callTool('verify', { package: 'zod' }, { ...stub(), url: baseUrl.replace(/\/mcp$/, '') });
    expect(lastRequest.body).toMatchObject({ method: 'tools/call' });
  });

  it('reads a result delivered as an SSE frame', async () => {
    reply = {
      contentType: 'text/event-stream',
      body: `event: message\ndata: ${toolResult({ name: 'zod' })}\n\n`,
    };
    const res = await callTool<{ name: string }>('evaluate', { package: 'zod' }, stub());
    expect(res.name).toBe('zod');
  });

  it('surfaces a JSON-RPC error message instead of stringifying the envelope', async () => {
    reply = {
      status: 401,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32001, message: 'Invalid API key.' },
      }),
    };
    await expect(callTool('verify', { package: 'zod' }, stub())).rejects.toThrow('Invalid API key.');
  });

  it('treats an isError tool result as a failure, not as a package record', async () => {
    reply = { body: toolResult('no such package', true) };
    await expect(callTool('evaluate', { package: 'nope' }, stub())).rejects.toThrow(
      'no such package',
    );
  });

  it('refuses to call without a key rather than sending an anonymous request', async () => {
    const saved = process.env.LURQ_API_KEY;
    delete process.env.LURQ_API_KEY;
    clearUserConfig();
    try {
      await expect(callTool('verify', { package: 'zod' }, { url: baseUrl })).rejects.toThrow(
        RemoteError,
      );
    } finally {
      if (saved) process.env.LURQ_API_KEY = saved;
    }
  });
});

describe('indexSource', () => {
  const saved = {
    key: process.env.LURQ_API_KEY,
    db: process.env.DATABASE_URL,
    local: process.env.LURQ_LOCAL,
  };

  beforeEach(() => {
    // Load the repo's .env first so it is already memoized; otherwise
    // indexSource's own loadEnv() would put the deleted vars straight back.
    loadEnv();
    delete process.env.LURQ_API_KEY;
    delete process.env.DATABASE_URL;
    delete process.env.LURQ_LOCAL;
    clearUserConfig();
  });

  afterAll(() => {
    if (saved.key) process.env.LURQ_API_KEY = saved.key;
    if (saved.db) process.env.DATABASE_URL = saved.db;
    if (saved.local) process.env.LURQ_LOCAL = saved.local;
  });

  it('prefers a stored key over a DATABASE_URL belonging to the user own app', () => {
    // The regression this guards: dotenv reads the `.env` of whatever directory
    // `lurq` was invoked in, so a user running `lurq recommend` inside their own
    // Postgres app would otherwise have package lookups pointed at that app's
    // database, failing with a confusing SQL error.
    writeUserConfig({ apiKey: 'lurq_live_stored' });
    process.env.DATABASE_URL = 'postgres://someone-elses-app/db';
    expect(indexSource()).toBe('hosted');
  });

  it('uses the local index when there is a DATABASE_URL and no key', () => {
    process.env.DATABASE_URL = 'postgres://lurq/index';
    expect(indexSource()).toBe('local');
  });

  it('lets an operator holding both force the local index', () => {
    writeUserConfig({ apiKey: 'lurq_live_stored' });
    process.env.DATABASE_URL = 'postgres://lurq/index';
    process.env.LURQ_LOCAL = '1';
    expect(indexSource()).toBe('local');
  });

  it('points an unconfigured machine at setup rather than at a stack trace', () => {
    expect(() => indexSource()).toThrow(/lurq setup/);
  });
});

describe('selection-policy reporting', () => {
  const saved = { key: process.env.LURQ_API_KEY, endpoint: process.env.LURQ_ENDPOINT };
  let out: string[];

  beforeEach(() => {
    loadEnv();
    process.env.LURQ_API_KEY = 'lurq_live_test';
    process.env.LURQ_ENDPOINT = baseUrl;
    delete process.env.DATABASE_URL;
    out = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => void out.push(a.join(' ')));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (saved.key) process.env.LURQ_API_KEY = saved.key;
    if (saved.endpoint) process.env.LURQ_ENDPOINT = saved.endpoint;
    else delete process.env.LURQ_ENDPOINT;
  });

  // policy/types.ts: exclusions are reported, never silently dropped, because an
  // agent (or a person) told "here are 3 options" when 5 were found will
  // re-derive the blocked one and install it directly.
  it('prints what a policy refused, and why, under the recommend table', async () => {
    reply = {
      body: toolResult({
        candidates: [{ name: 'ky', healthScore: 82, confidence: 'proven', weeklyDownloads: 1 }],
        excluded: [{ name: 'axios', rule: 'denied', reason: 'use our internal http client' }],
      }),
    };
    const { runRecommend } = await import('../src/cli/commands');
    await runRecommend('an http client', {});

    const text = out.join('\n');
    expect(text).toContain('ky');
    expect(text).toContain('policy refused 1');
    expect(text).toContain('axios');
    expect(text).toContain('use our internal http client');
  });

  it('says nothing about policy when no rules are in force', async () => {
    reply = {
      body: toolResult({
        candidates: [{ name: 'ky', healthScore: 82, confidence: 'proven', weeklyDownloads: 1 }],
      }),
    };
    const { runRecommend } = await import('../src/cli/commands');
    await runRecommend('an http client', {});
    expect(out.join('\n')).not.toContain('policy');
  });

  it('leads an evaluate with a blocked verdict rather than burying it', async () => {
    reply = {
      body: toolResult({
        name: 'axios',
        healthScore: 88,
        confidence: 'proven',
        weeklyDownloads: 1,
        policy: { allowed: false, name: 'axios', rule: 'denied', reason: 'use the internal client' },
      }),
    };
    const { runEvaluate } = await import('../src/cli/commands');
    await runEvaluate('axios', {});

    const lines = out.join('\n').split('\n');
    expect(lines.some((l) => l.includes('policy: blocked') && l.includes('denied'))).toBe(true);
    // Above the scores: it is the most actionable line in the output.
    const verdictAt = lines.findIndex((l) => l.includes('policy: blocked'));
    const healthAt = lines.findIndex((l) => l.includes('health'));
    expect(verdictAt).toBeLessThan(healthAt);
  });
});

describe('runSetup endpoint handling', () => {
  const OWN = 'https://lurq.internal/mcp';
  const savedHome = process.env.HOME;
  const savedEndpoint = process.env.LURQ_ENDPOINT;

  beforeEach(() => {
    // A throwaway HOME so agent detection finds nothing and no real config is
    // touched; setup then only writes ~/.lurq, which LURQ_HOME already isolates.
    process.env.HOME = mkdtempSync(join(tmpdir(), 'lurq-setup-home-'));
    process.env.LURQ_HOME = mkdtempSync(join(tmpdir(), 'lurq-setup-cfg-'));
    delete process.env.LURQ_ENDPOINT;
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (savedHome) process.env.HOME = savedHome;
    if (savedEndpoint) process.env.LURQ_ENDPOINT = savedEndpoint;
  });

  it('stores a self-hosted endpoint and leaves the default one unstored', async () => {
    await runSetup({ yes: true, apiKey: 'lurq_live_a', url: OWN });
    expect(readUserConfig().endpoint).toBe(OWN);

    // Storing the default would pin the machine to today's URL and ignore a
    // later change to the built-in.
    await runSetup({ yes: true, apiKey: 'lurq_live_a', url: DEFAULT_ENDPOINT });
    expect(readUserConfig().endpoint).toBeUndefined();
  });

  it('keeps a self-hoster on their own endpoint when setup is re-run bare', async () => {
    // The regression: re-running setup to wire up a newly-installed editor used
    // to recompute the URL from flags and env only, silently moving a
    // self-hosted machine back onto the shared service and rewriting every
    // agent config to point at it.
    await runSetup({ yes: true, apiKey: 'lurq_live_a', url: OWN });
    await runSetup({ yes: true });
    expect(readUserConfig().endpoint).toBe(OWN);
  });

  it('lets an explicit flag move a machine back to the default', async () => {
    await runSetup({ yes: true, apiKey: 'lurq_live_a', url: OWN });
    await runSetup({ yes: true, url: DEFAULT_ENDPOINT });
    expect(readUserConfig().endpoint).toBeUndefined();
  });

  it('stores the key even when no agent is installed yet', async () => {
    await runSetup({ yes: true, apiKey: 'lurq_live_solo' });
    expect(readUserConfig().apiKey).toBe('lurq_live_solo');
  });
});

// Getting this wrong is expensive in both directions: a false negative leaves an
// npx user with a configured machine and no `lurq` command, and a false positive
// runs `npm install --global` on someone who never asked for it.
describe('npx detection', () => {
  it('recognises npm’s npx cache and nothing else', () => {
    expect(runningFromNpx('file:///Users/x/.npm/_npx/8f3a/node_modules/lurqrun/dist/bin/lurq.js')).toBe(true);
    // Windows npx cache: still a slash-separated file URL.
    expect(runningFromNpx('file:///C:/Users/x/AppData/npm-cache/_npx/1b2/node_modules/lurqrun/dist/bin/lurq.js')).toBe(true);

    expect(runningFromNpx('file:///usr/local/lib/node_modules/lurqrun/dist/bin/lurq.js')).toBe(false);
    expect(runningFromNpx('file:///Users/x/proj/node_modules/lurqrun/dist/bin/lurq.js')).toBe(false);
    // A project that merely has "_npx" in a directory name is not an npx run.
    expect(runningFromNpx('file:///Users/x/my_npx_experiments/dist/bin/lurq.js')).toBe(false);
  });
});
