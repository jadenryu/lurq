/**
 * MCP server (§12). Exposes recommend / evaluate / compare / verify over stdio.
 * Inputs are validated with zod; outputs are compact JSON text (§12.4).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { SERVER_NAME, VERSION } from '../core/constants';
import { CATEGORIES, type Category } from '../core/types';
import { createDb } from '../db/client';
import { logger } from '../core/logger';
import { handleCompare, handleEvaluate, handleRecommend, handleVerify } from './handlers';
import { handleDiagram } from './diagram';

const categoryEnum = z.enum(CATEGORIES as unknown as [Category, ...Category[]]);
const confidenceEnum = z.enum(['proven', 'emerging', 'promising', 'unproven']);

const constraintsSchema = z
  .object({
    runtime: z.enum(['browser', 'node', 'both']).optional(),
    license: z.string().optional(),
    maxBundleKb: z.number().positive().optional(),
    minConfidence: confidenceEnum.optional(),
  })
  .optional();

/** Wrap any result object as a compact MCP text response. */
function json(obj: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(obj) }] };
}

export function buildMcpServer(db: ReturnType<typeof createDb>['db']): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: VERSION });

  server.registerTool(
    'recommend',
    {
      title: 'Recommend packages',
      description:
        'Recommend the best current npm packages for a described need — fresh, objectively scored, with confidence labels. Call before choosing or hand-rolling a dependency.',
      inputSchema: {
        need: z.string().min(1).describe('Natural-language description of what you need'),
        category: categoryEnum.optional().describe('Optional taxonomy category to restrict to'),
        constraints: constraintsSchema,
      },
    },
    async (args) => json(await handleRecommend(db, args)),
  );

  server.registerTool(
    'evaluate',
    {
      title: 'Evaluate a package',
      description:
        'Full evidence read for one npm package: scores, signals, advisories, summary, and a usage guide. Fetches & scores on demand if not yet tracked.',
      inputSchema: {
        package: z.string().min(1).describe('npm package name'),
      },
    },
    async (args) => json(await handleEvaluate(db, args)),
  );

  server.registerTool(
    'compare',
    {
      title: 'Compare packages',
      description: 'Side-by-side comparison of 2–5 npm packages, ranked by health score.',
      inputSchema: {
        packages: z.array(z.string().min(1)).min(2).max(5).describe('2–5 npm package names'),
      },
    },
    async (args) => json(await handleCompare(db, args)),
  );

  server.registerTool(
    'verify',
    {
      title: 'Verify a package',
      description:
        'Confirm an npm package is real, healthy, and not risky before installing — guards against hallucinated or typosquatted dependency names. Checks the live registry.',
      inputSchema: {
        package: z.string().min(1).describe('npm package name to verify'),
      },
    },
    async (args) => json(await handleVerify(db, args)),
  );

  server.registerTool(
    'diagram',
    {
      title: 'Reference architecture diagram',
      description:
        'Emit a reference-architecture Mermaid diagram for a stack you have already chosen (package names). A labeled starting point keyed by layer — not a validated architecture, and not an architecture designer.',
      inputSchema: {
        stack: z
          .array(z.string())
          .optional()
          .describe('Package names that make up the stack; omit or empty to get usage guidance'),
      },
    },
    async (args) => json(await handleDiagram(db, args)),
  );

  return server;
}

export async function startMcpServer(): Promise<void> {
  const { db, close } = createDb();
  const server = buildMcpServer(db);

  const shutdown = async () => {
    try {
      await close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info(`${SERVER_NAME} MCP server v${VERSION} running on stdio.`);
}
