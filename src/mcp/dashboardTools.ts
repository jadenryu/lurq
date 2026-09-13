/**
 * The package tools the dashboard's Ask may call, run through the real MCP server.
 *
 * Ask used to hold four account readers and nothing else, so "should we take zod 4"
 * got "I don't have that tool" from a product whose whole job is answering it. The
 * answers already exist as MCP tools; this reaches them over an in-memory transport
 * instead of re-declaring them, so Ask gets the same zod validation, the same
 * handlers and the same per-owner usage row as an agent holding an API key. A schema
 * change in server.ts cannot leave a second copy here drifting out of step.
 *
 * The allowlist is read-only lookups that need nothing but a package name. Not
 * `audit` (it wants a local inventory the dashboard does not have), not
 * `report_outcome` (a write attributed to an agent's decision), not the raw surface
 * dumps (`usage`, `resolve_surface`), whose size would spend a question's budget on
 * one result.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { createDb } from '../db/client';
import { buildMcpServer } from './server';

type Db = ReturnType<typeof createDb>['db'];

export const DASHBOARD_TOOLS: ReadonlySet<string> = new Set([
  'evaluate',
  'compare',
  'verify',
  'compat',
  'diff_surface',
  'mcp_surface',
  'mcp_drift',
  'mcp_stack',
]);

export interface DashboardTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

async function connect(db: Db, ownerId: string | null) {
  const server = buildMcpServer(db, { ownerId });
  const client = new Client({ name: 'lurq-dashboard', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, close: () => Promise.all([client.close(), server.close()]) };
}

// ponytail: memoised per process; the list only changes when this service deploys.
let listed: Promise<DashboardTool[]> | null = null;

export function listDashboardTools(db: Db): Promise<DashboardTool[]> {
  listed ??= (async () => {
    const { client, close } = await connect(db, null);
    try {
      const { tools } = await client.listTools();
      return tools
        .filter((t) => DASHBOARD_TOOLS.has(t.name))
        .map((t) => ({ name: t.name, description: t.description ?? '', inputSchema: t.inputSchema }));
    } finally {
      await close();
    }
  })().catch((err) => {
    listed = null; // a failed listing is retried next time, not cached
    throw err;
  });
  return listed;
}

/** Run one allowlisted tool as `ownerId`. The text is the tool's JSON, unparsed. */
export async function callDashboardTool(
  db: Db,
  ownerId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; text: string }> {
  if (!DASHBOARD_TOOLS.has(name)) throw new Error(`Tool not available to Ask: ${name}`);
  const { client, close } = await connect(db, ownerId);
  try {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as { type: string; text?: string }[])
      .flatMap((c) => (c.type === 'text' && c.text ? [c.text] : []))
      .join('\n');
    return { isError: result.isError === true, text };
  } finally {
    await close();
  }
}
