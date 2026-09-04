/**
 * MCP server (§12). Exposes recommend / evaluate / compare / verify over stdio.
 * Inputs are validated with zod; outputs are compact JSON text (§12.4).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { SERVER_NAME, VERSION } from '../core/constants';
import { CATEGORIES, type Category } from '../core/types';
import { searchCapabilities } from '../core/capabilities';
import { createDb } from '../db/client';
import { logger } from '../core/logger';
import { handleDiffSurface, handleResolveSurface } from './surfaceHandlers';
import {
  handleCompare,
  handleCompat,
  handleEvaluate,
  handleReportOutcome,
  handleUsage,
  handleVerify,
} from './handlers';
import { handleDiagram } from './diagram';
import { timed } from './metrics';
import { compact } from './compact';
import {
  COMPAT_DESCRIPTION,
  COMPAT_NODE_DESCRIPTION,
  COMPAT_PACKAGES_DESCRIPTION,
  COMPAT_VERSIONS_DESCRIPTION,
  VERIFY_DESCRIPTION,
} from './toolDescriptions';
import { recordUsage } from '../db/usage';


// Validate package names at the trust boundary. A name flows straight into a
// registry URL (`registry.npmjs.org/${name}`) and the response cache key, so
// reject anything that isn't a legal npm name: this blocks path/query
// injection (`/`, `?`, `#`, `%`), whitespace, and control characters. Case is
// permitted for legacy packages; the char class is what closes the hole.
export const npmName = z
  .string()
  .trim()
  .min(1)
  .max(214)
  .regex(/^(?:@[a-z0-9-][a-z0-9-._]*\/)?[a-z0-9-][a-z0-9-._]*$/i, 'Invalid npm package name');

/** Wrap any result object as a compact MCP text response. `compact` strips
 *  null/empty fields so the agent's context only carries signal (§12.4). */
function json(obj: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(compact(obj)) }] };
}

/**
 * Per-connection identity, resolved from the authenticated API key at the HTTP
 * boundary and threaded into the tools. This is the channel that lets lurq know
 * *who* is calling — stamped onto the data it collects (§3.1 flywheel) so it
 * accrues to an individual account instead of an anonymous pool. `ownerId` is
 * null on the stdio/local path and for operator-issued keys with no account.
 */
export interface ServerContext {
  ownerId?: string | null;
}

export function buildMcpServer(
  db: ReturnType<typeof createDb>['db'],
  ctx: ServerContext = {},
): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: VERSION });

  // Run a tool with Prometheus timing (metrics) AND a fire-and-forget per-user
  // usage counter for the dashboard (§ dashboard v1 phase 2). The counter is
  // recorded in a finally so an errored call still counts; recordUsage no-ops
  // when ctx.ownerId is null (stdio/local or operator keys with no account).
  const run = <T>(tool: string, fn: () => Promise<T>): Promise<T> =>
    (async () => {
      try {
        return await timed(tool, fn);
      } finally {
        void recordUsage(db, ctx.ownerId ?? null, tool);
      }
    })();

  server.registerTool(
    'evaluate',
    {
      title: 'Evaluate a package',
      description:
        'Full evidence read for one npm package: scores, signals, advisories, summary, and a usage guide. Fetches & scores on demand if not yet tracked.',
      inputSchema: {
        package: npmName.describe('npm package name'),
      },
    },
    async (args) => json(await run('evaluate', () => handleEvaluate(db, args, ctx.ownerId ?? null))),
  );

  server.registerTool(
    'compare',
    {
      title: 'Compare packages',
      description: 'Side-by-side comparison of 2–5 npm packages, ranked by health score.',
      inputSchema: {
        packages: z.array(npmName).min(2).max(5).describe('2–5 npm package names'),
      },
    },
    async (args) => json(await run('compare', () => handleCompare(db, args, ctx.ownerId ?? null))),
  );

  server.registerTool(
    'compat',
    {
      title: 'Check package compatibility',
      description: COMPAT_DESCRIPTION,
      inputSchema: {
        packages: z.array(npmName).min(2).max(8).describe(COMPAT_PACKAGES_DESCRIPTION),
        versions: z.record(z.string()).optional().describe(COMPAT_VERSIONS_DESCRIPTION),
        node: z.string().optional().describe(COMPAT_NODE_DESCRIPTION),
      },
    },
    async (args) => json(await run('compat', () => handleCompat(db, args))),
  );

  server.registerTool(
    'verify',
    {
      title: 'Verify a package',
      description: VERIFY_DESCRIPTION,
      inputSchema: {
        package: npmName.describe('npm package name to verify'),
      },
    },
    async (args) => json(await run('verify', () => handleVerify(db, args, ctx.ownerId ?? null))),
  );

  server.registerTool(
    'usage',
    {
      title: 'Version-exact API surface + drift',
      description:
        "Get a package version's real public API, the exported symbols and signatures extracted from its shipped .d.ts, exact to the version, none of it in the model's training data. Pass knownVersion (e.g. the version you were trained on) to get the precise delta: what was added, removed, renamed, or changed. Also returns the version's declared engines (Node/runtime floor) so you don't write code against a version the target runtime cannot install. Use before writing code against a package whose API may have moved. For framework file/convention changes (not exported symbols), consult the official migration guide / Context7 instead.",
      inputSchema: {
        package: npmName.describe('npm package name'),
        version: z.string().optional().describe('Target version (defaults to latest)'),
        knownVersion: z
          .string()
          .optional()
          .describe('A version you already know; returns the API delta from it to the target'),
      },
    },
    async (args) => json(await run('usage', () => handleUsage(db, args))),
  );

  server.registerTool(
    'diagram',
    {
      title: 'Reference architecture diagram',
      description:
        'Emit a reference-architecture Mermaid diagram for a stack you have already chosen (package names). A labeled starting point keyed by layer, not a validated architecture, and not an architecture designer.',
      inputSchema: {
        stack: z
          .array(npmName)
          .optional()
          .describe('Package names that make up the stack; omit or empty to get usage guidance'),
      },
    },
    async (args) => json(await run('diagram', () => handleDiagram(db, args))),
  );

  server.registerTool(
    'resolve_surface',
    {
      title: 'Version-exact runtime surface',
      description:
        "What a package version ACTUALLY exports at runtime, extracted from its shipped JavaScript rather than from documentation or the model's memory. Call before writing code against a package whose API may have moved. Runtime existence is what decides whether an import throws; a removed type breaks tsc, a removed runtime symbol breaks the program. A miss returns UNKNOWN and queues extraction, UNKNOWN never means the symbol is absent.",
      inputSchema: {
        package: npmName.describe('npm package name'),
        version: z.string().optional().describe('Exact version; omit for the latest extracted'),
      },
    },
    async (args) => json(await run('resolve_surface', () => handleResolveSurface(db, args))),
  );

  server.registerTool(
    'diff_surface',
    {
      title: 'Surface diff between two versions',
      description:
        'What changed in a package\'s runtime surface between two versions: symbols removed, added, and arity changes. Removals break `node`; type-only removals are returned separately because they break `tsc` instead. Answers "when did this stop working" from static comparison, with no install required. Use before an upgrade, and to explain a break after one.',
      inputSchema: {
        package: npmName.describe('npm package name'),
        fromVersion: z.string().describe('Version you are on'),
        toVersion: z.string().describe('Version you are moving to'),
      },
    },
    async (args) => json(await run('diff_surface', () => handleDiffSurface(db, args))),
  );

  // Self-description, and the only tool that reads nothing. An agent holding
  // eleven lurq tools still has to guess which one answers the situation in
  // front of it; this turns that guess into a lookup, and returns the exact tool
  // name to call next rather than prose about it. No db, no key, no usage row —
  // asking what a tool does is not usage of it.
  server.registerTool(
    'capabilities',
    {
      title: 'What lurq can do',
      description:
        "Look up which lurq tool answers a situation, and what to run next. Call when you're unsure whether lurq covers something (an upgrade, a licence rule, a version's exact exports, publishing a package) instead of guessing or skipping it. Returns matching capabilities with the tool or command to use.",
      inputSchema: {
        query: z
          .string()
          .max(300)
          .optional()
          .describe('What you are trying to do, in plain words. Omit for the full menu.'),
      },
    },
    async (args) => json({ capabilities: searchCapabilities(args.query ?? '', 6) }),
  );

  server.registerTool(
    'report_outcome',
    {
      title: 'Report a recommendation outcome',
      description:
        'Opt-in feedback after acting on a lurq recommendation: report whether you went with the package and whether it built. No source code, only the coarse decision + a build signal. Helps lurq learn which packages agents actually succeed with; safe to skip.',
      inputSchema: {
        package: npmName.describe('The package that was recommended'),
        accepted: z.boolean().describe('Did you go with this package?'),
        buildSignal: z
          .enum(['installed', 'compiled', 'tests_passed', 'failed'])
          .optional()
          .describe('Coarse post-install result, if known'),
        need: z
          .string()
          .max(500)
          .optional()
          .describe('The original need this was recommended for (no source code)'),
      },
    },
    // ownerId comes from the authenticated key (ctx), NOT the tool arguments —
    // a caller must never be able to attribute an outcome to another org.
    async (args) =>
      json(await run('report_outcome', () => handleReportOutcome(db, args, ctx.ownerId ?? null))),
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
