/**
 * What an agent is told about lurq's tools, checked against the tools that exist.
 *
 * `recommend` and `plan` were removed (4483173) while the server instructions,
 * two tool descriptions and both installed agent templates kept telling agents
 * to call them. A model follows those instructions, calls a tool that is not
 * there, and burns a turn on "unknown tool".
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { searchCapabilities } from '../src/core/capabilities';
import { loadEnv, resetConfigCache } from '../src/core/config';
import { buildMcpServer, SERVE_NEEDS_DATABASE, startMcpServer } from '../src/mcp/server';

const REMOVED = /\b(recommend|plan)\b/i;

describe('the tool contract an agent receives', () => {
  const client = new Client({ name: 'agent', version: '0' });
  const server = buildMcpServer({} as never);
  let tools: Tool[];

  beforeAll(async () => {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    tools = (await client.listTools()).tools;
  });
  afterAll(async () => {
    await client.close();
    await server.close();
  });

  it('never names a removed tool in the instructions or a description', () => {
    expect(client.getInstructions()).not.toMatch(REMOVED);
    for (const t of tools) expect(`${t.name}: ${t.description}`).not.toMatch(REMOVED);
  });

  it('annotates every tool, and only report_outcome writes', () => {
    for (const t of tools) {
      expect(t.annotations, t.name).toBeDefined();
      expect(t.annotations?.readOnlyHint, t.name).toBe(t.name !== 'report_outcome');
    }
  });

  it('points capabilities only at tools that are registered', () => {
    const names = new Set(tools.map((t) => t.name));
    for (const c of searchCapabilities('', 1000)) if (c.mcp) expect(names, c.mcp).toContain(c.mcp);
  });

  it('ships agent templates that call only registered tools', () => {
    for (const file of ['skill-instructions.md', 'agent-rules.md']) {
      const text = readFileSync(join(__dirname, '..', 'templates', file), 'utf8');
      expect(text, file).not.toMatch(/`(recommend|plan)\b/);
      expect(text, file).not.toMatch(/\brecommend\b/i);
    }
  });
});

describe('lurq serve without a database', () => {
  it('fails before the handshake with a way forward, not a bare missing-variable error', async () => {
    loadEnv(); // load .env now, or getConfig() loads it after the delete and a local DATABASE_URL comes back
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    resetConfigCache();
    try {
      await expect(startMcpServer()).rejects.toThrow(SERVE_NEEDS_DATABASE);
      expect(SERVE_NEEDS_DATABASE).toContain('npx lurqrun');
    } finally {
      if (saved !== undefined) process.env.DATABASE_URL = saved;
      resetConfigCache();
    }
  });
});
