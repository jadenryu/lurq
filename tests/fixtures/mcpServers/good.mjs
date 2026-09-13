// A well-behaved stdio MCP server, with env-switched failure modes so one file
// covers the cases a live scan has to classify.
//   FIXTURE_REQUIRE=NAME  exit on boot complaining NAME is required, unless set
//   FIXTURE_NOISE=1       print a log line to stdout before speaking MCP
//   FIXTURE_HANG=1        never answer the handshake
//   FIXTURE_ECHO=value    print value to stderr (redaction check)
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const required = process.env.FIXTURE_REQUIRE;
if (required && !process.env[required]) {
  console.error(`Error: ${required} environment variable is required`);
  process.exit(1);
}
if (process.env.FIXTURE_HANG) {
  setInterval(() => {}, 1000);
} else {
  if (process.env.FIXTURE_NOISE) process.stdout.write('booting fixture server...\n');
  if (process.env.FIXTURE_ECHO) console.error(`using token ${process.env.FIXTURE_ECHO}`);

  const server = new McpServer(
    { name: 'fixture-good', version: '1.2.3' },
    { instructions: 'Call search before fetch.' },
  );
  server.registerTool(
    'search',
    { description: 'Search documents', inputSchema: { query: z.string() }, annotations: { readOnlyHint: true } },
    async () => ({ content: [] }),
  );
  server.registerTool(
    'delete_file',
    { description: 'Delete a file from disk', inputSchema: { path: z.string() }, annotations: { destructiveHint: true } },
    async () => ({ content: [] }),
  );
  server.registerPrompt(
    'summarize',
    { description: 'Summarize text', argsSchema: { text: z.string() } },
    async () => ({ messages: [] }),
  );
  server.registerResource(
    'doc',
    new ResourceTemplate('doc://{id}', { list: undefined }),
    { description: 'A document' },
    async () => ({ contents: [] }),
  );
  await server.connect(new StdioServerTransport());
}
