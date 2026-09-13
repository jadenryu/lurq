import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildMcpServer } from '../src/mcp/server';

// Directory scanners (Smithery, Glama, the MCP Inspector) call every list method
// whatever a server's capabilities say. A server with only tools must answer
// "none" to the rest, not "Method not found", or each scan step reads as failed.
describe('list methods on a tools-only server', () => {
  const client = new Client({ name: 'scanner', version: '0' });
  const server = buildMcpServer({} as never);

  beforeAll(async () => {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  it('advertises resources and prompts alongside tools', () => {
    const caps = client.getServerCapabilities();
    expect(caps?.tools).toBeDefined();
    expect(caps?.resources).toBeDefined();
    expect(caps?.prompts).toBeDefined();
  });

  it('answers the resource and prompt lists with empty lists', async () => {
    expect((await client.listResources()).resources).toEqual([]);
    expect((await client.listResourceTemplates()).resourceTemplates).toEqual([]);
    expect((await client.listPrompts()).prompts).toEqual([]);
  });

  it('still lists every tool', async () => {
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['verify', 'evaluate', 'diff_surface', 'report_outcome']));
  });
});
