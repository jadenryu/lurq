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
import {
  handleCompare,
  handleCompat,
  handleEvaluate,
  handleRecommend,
  handleReportOutcome,
  handleVerify,
} from './handlers';
import { handleDiagram } from './diagram';
import { handlePlan } from './plan';
import { timed } from './metrics';
import { compact } from './compact';

const categoryEnum = z.enum(CATEGORIES as unknown as [Category, ...Category[]]);
const confidenceEnum = z.enum(['proven', 'emerging', 'promising', 'unproven']);

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

const constraintsSchema = z
  .object({
    runtime: z.enum(['browser', 'node', 'both']).optional(),
    license: z.string().optional(),
    maxBundleKb: z.number().positive().optional(),
    minConfidence: confidenceEnum.optional(),
  })
  .optional();

/** Wrap any result object as a compact MCP text response. `compact` strips
 *  null/empty fields so the agent's context only carries signal (§12.4). */
function json(obj: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(compact(obj)) }] };
}

/**
 * Per-connection identity, resolved from the authenticated API key at the HTTP
 * boundary and threaded into the tools. This is the channel that lets lurq know
 * *who* is calling — stamped onto the data it collects (§3.1 flywheel) so it
 * accrues to an org instead of an anonymous pool. `ownerId` is null on the stdio
 * / local path and for operator-issued keys with no org.
 */
export interface ServerContext {
  ownerId?: string | null;
}

export function buildMcpServer(
  db: ReturnType<typeof createDb>['db'],
  ctx: ServerContext = {},
): McpServer {
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
    async (args) => json(await timed('recommend', () => handleRecommend(db, args))),
  );

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
    async (args) => json(await timed('evaluate', () => handleEvaluate(db, args))),
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
    async (args) => json(await timed('compare', () => handleCompare(db, args))),
  );

  server.registerTool(
    'compat',
    {
      title: 'Check package compatibility',
      description:
        'Check whether a set of packages forms a coherent stack: peer-dependency and engine-range compatibility across the whole set (instant, from declared metadata), plus any recorded sandbox-verified conflicts. Returns the exact clashing constraints. Read-only — does not run installs. Call before committing to a multi-package stack.',
      inputSchema: {
        packages: z
          .array(npmName)
          .min(2)
          .max(8)
          .describe('2–8 npm package names to check together'),
      },
    },
    async (args) => json(await timed('compat', () => handleCompat(db, args))),
  );

  server.registerTool(
    'verify',
    {
      title: 'Verify a package',
      description:
        'Confirm an npm package is real, healthy, and not risky before installing — guards against hallucinated or typosquatted dependency names. Checks the live registry.',
      inputSchema: {
        package: npmName.describe('npm package name to verify'),
      },
    },
    async (args) => json(await timed('verify', () => handleVerify(db, args))),
  );

  server.registerTool(
    'diagram',
    {
      title: 'Reference architecture diagram',
      description:
        'Emit a reference-architecture Mermaid diagram for a stack you have already chosen (package names). A labeled starting point keyed by layer — not a validated architecture, and not an architecture designer.',
      inputSchema: {
        stack: z
          .array(npmName)
          .optional()
          .describe('Package names that make up the stack; omit or empty to get usage guidance'),
      },
    },
    async (args) => json(await timed('diagram', () => handleDiagram(db, args))),
  );

  server.registerTool(
    'plan',
    {
      title: 'Plan a stack from a program description',
      description:
        'Turn a detailed program description (spec/README) or a list of component needs into an evidence-scored build plan: a real, lurq-scored package recommended per component, plus a Mermaid roadmap other agents can parse. Recommends building blocks slot-by-slot from the index — it does not invent an architecture from a bare prompt.',
      inputSchema: {
        document: z
          .string()
          .optional()
          .describe('Detailed description of the program (spec/README); lurq decomposes it into components'),
        needs: z
          .array(
            z.object({
              need: z.string().min(1).describe('A component that needs a library'),
              category: categoryEnum.optional(),
            }),
          )
          .optional()
          .describe('Pre-decomposed components (skip if you pass a document)'),
        using: z
          .array(npmName)
          .max(12)
          .optional()
          .describe(
            'Packages you have already decided on. lurq pins these as fixed slots, recommends only the remaining needs, and checks/optimizes the whole stack around your picks.',
          ),
        optimize: z
          .enum(['speed', 'balanced'])
          .optional()
          .describe("'speed' prefers the lightest-bundle option per slot; default 'balanced'"),
      },
    },
    async (args) => json(await timed('plan', () => handlePlan(db, args))),
  );

  server.registerTool(
    'report_outcome',
    {
      title: 'Report a recommendation outcome',
      description:
        'Opt-in feedback after acting on a lurq recommendation: report whether you went with the package and whether it built. No source code — only the coarse decision + a build signal. Helps lurq learn which packages agents actually succeed with; safe to skip.',
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
      json(await timed('report_outcome', () => handleReportOutcome(db, args, ctx.ownerId ?? null))),
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
