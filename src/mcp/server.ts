/**
 * MCP server (§12). Exposes lurq's evidence tools (verify, evaluate, compat, usage, …) over stdio.
 * Inputs are validated with zod; outputs are compact JSON text (§12.4).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListPromptsRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import semver from 'semver';
import { getConfig } from '../core/config';
import { SERVER_NAME, VERSION } from '../core/constants';
import { searchCapabilities } from '../core/capabilities';
import { createDb } from '../db/client';
import { logger } from '../core/logger';
import { handleDiffSurface, handleResolveSurface } from './surfaceHandlers';
import { handleMcpDrift, handleMcpSurface } from './mcpHandlers';
import { handleAudit } from './auditHandler';
import {
  handleCompare,
  handleCompat,
  handleEvaluate,
  handlePolicy,
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
import { capture } from '../core/analytics';

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

/**
 * An exact semver version, and nothing else.
 *
 * This is a trust boundary, not a formatting preference. A caller-supplied
 * version string ends up as a dependency value in the `package.json` that
 * `resolveSet` hands to npm. Anything that is not a semver version is a
 * different kind of specifier — `git+ssh://host/repo`, `file:../x`, a tarball
 * URL — and npm will dutifully go fetch it, which turns this parameter into
 * caller-directed network egress from our container. `semver.valid` accepts
 * exactly the versions `assembleMembers` can pin against and nothing else.
 */
export const exactVersion = z
  .string()
  .trim()
  .max(256)
  .refine((v) => semver.valid(v) !== null, 'Must be an exact semver version, e.g. "19.0.0"');


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
  /** Appended to every tool result: the quota notice once an account is past its pool. */
  notice?: string | null;
}

/**
 * What an MCP client tells its model about lurq when it connects. Clients that
 * support server instructions put this in front of the agent before any tool
 * list, so it carries the two things a tool list cannot: when to reach for lurq
 * at all, and that its findings belong in front of the user.
 */
const SERVER_INSTRUCTIONS = [
  'lurq answers npm package questions from evidence instead of training data.',
  'Call verify before installing any package, compat before committing to a set of versions, and usage before writing code against a package API that may have moved.',
  'When choosing a library, bring the candidates you know and check them with compare or evaluate: lurq verifies choices, it does not search for them.',
  'If unsure which tool fits, call capabilities.',
  'When lurq flags a problem (a package that does not exist, a deprecation, an advisory, a version conflict), tell the user what it found and that it came from lurq, with the evidence it returned.',
].join(' ');

/**
 * Tool behaviour hints (MCP ToolAnnotations), so a client can auto-approve the
 * safe calls and gate the one that writes.
 *
 * Read-only is from the caller's side: a lookup may ingest, cache or queue an
 * extraction inside lurq, but nothing the agent or its user owns changes, and
 * repeating it is harmless. `openWorldHint` marks the tools that can reach the
 * live npm registry, CDN or OSV during the request, as opposed to answering
 * from lurq's own index.
 */
const READ_INDEX = { readOnlyHint: true, openWorldHint: false } as const;
const READ_LIVE = { readOnlyHint: true, openWorldHint: true } as const;

export function buildMcpServer(
  db: ReturnType<typeof createDb>['db'],
  ctx: ServerContext = {},
): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );

  // Run a tool with Prometheus timing (metrics) AND a fire-and-forget per-user
  // usage counter for the dashboard (§ dashboard v1 phase 2). The counter is
  // recorded in a finally so an errored call still counts; recordUsage no-ops
  // when ctx.ownerId is null (stdio/local or operator keys with no account).
  // The PostHog event carries the tool name and outcome only, never arguments,
  // and no-ops under the same null-owner rule (src/core/analytics.ts).
  const run = <T>(tool: string, fn: () => Promise<T>): Promise<T> =>
    (async () => {
      let ok = false;
      try {
        const result = await timed(tool, fn);
        ok = true;
        return result;
      } finally {
        void recordUsage(db, ctx.ownerId ?? null, tool);
        capture(ctx.ownerId, 'tool_called', { tool, ok });
      }
    })();

  // Every tool result leaves through here, so a notice reaches the agent however
  // the tool built its payload.
  const reply = (obj: unknown) => {
    const result = json(obj);
    if (ctx.notice) result.content.push({ type: 'text' as const, text: ctx.notice });
    return result;
  };

  server.registerTool(
    'evaluate',
    {
      title: 'Evaluate a package',
      description:
        "Full evidence read for one npm package: health and quality scores and the signals behind them, advisories, the shared safety verdict, a summary and a usage guide. Use it when a choice needs more than verify's install gate. Enforces the account's dependency policy. A package lurq has never tracked is fetched and scored on demand, waiting up to ~4 seconds; if scoring takes longer the result is `tracked: false` with a note to retry in a few seconds, which is not an answer about the package.",
      annotations: READ_LIVE,
      inputSchema: {
        package: npmName.describe('npm package name'),
      },
    },
    async (args) =>
      reply(await run('evaluate', () => handleEvaluate(db, args, ctx.ownerId ?? null))),
  );

  // Read-only on purpose. There is no tool that writes policy: the agent being
  // governed must not be able to edit its own rules. People change policy in the
  // dashboard or with `lurq policy push` and a scoped key.
  server.registerTool(
    'policy',
    {
      title: 'Read the dependency policy',
      description:
        "The rules this account's selection policy enforces on which packages you may add: denied packages (with the reason), license allowlist, confidence, advisory, adoption, staleness and bundle-size floors. Read it once before choosing dependencies so you pick an allowed package first; evaluate already enforces it. Read-only.",
      annotations: READ_INDEX,
      inputSchema: {},
    },
    async () => reply(await run('policy', () => handlePolicy(db, ctx.ownerId ?? null))),
  );

  server.registerTool(
    'compare',
    {
      title: 'Compare packages',
      description:
        'Side-by-side comparison of 2–5 npm packages you are choosing between, ranked by health score. Untracked names are fetched on demand; one still being scored comes back under `pending` (retry shortly), and a name not on npm under `notFound`.',
      annotations: READ_LIVE,
      inputSchema: {
        packages: z.array(npmName).min(2).max(5).describe('2–5 npm package names'),
      },
    },
    async (args) => reply(await run('compare', () => handleCompare(db, args, ctx.ownerId ?? null))),
  );

  server.registerTool(
    'compat',
    {
      title: 'Check package compatibility',
      description: COMPAT_DESCRIPTION,
      annotations: READ_LIVE,
      inputSchema: {
        packages: z.array(npmName).min(2).max(30).describe(COMPAT_PACKAGES_DESCRIPTION),
        versions: z.record(exactVersion).optional().describe(COMPAT_VERSIONS_DESCRIPTION),
        node: z.string().optional().describe(COMPAT_NODE_DESCRIPTION),
      },
    },
    async (args) => reply(await run('compat', () => handleCompat(db, args))),
  );

  server.registerTool(
    'verify',
    {
      title: 'Verify a package',
      description: VERIFY_DESCRIPTION,
      annotations: READ_LIVE,
      inputSchema: {
        package: npmName.describe('npm package name to verify'),
      },
    },
    async (args) => {
      const result = await run('verify', () => handleVerify(db, args, ctx.ownerId ?? null));
      // A package worth installing is a package about to be coded against, from memory.
      const usable = result.exists && result.verdict.level !== 'invalid' && result.verdict.level !== 'high';
      const next = `Before writing code against ${args.package}, call usage with it (and knownVersion if you remember one): its API may have moved since your training.`;
      return reply(usable ? { ...result, next } : result);
    },
  );

  server.registerTool(
    'usage',
    {
      title: 'Version-exact API surface + drift',
      description:
        "A package version's TYPED API: exported symbols and their signatures from its shipped .d.ts (or DefinitelyTyped), exact to the version, none of it in the model's training data. Use before writing code against a package whose API may have moved. For whether a name exists at RUNTIME (what decides if an import throws) use resolve_surface; for is-it-safe-to-install use verify. Pass knownVersion (e.g. the version you were trained on) to get the precise delta: added, removed, renamed, changed. Also returns the version's declared engines (Node/runtime floor). Large surfaces are paged, 80 symbols per call: `totalSymbols` is the size, `query` filters by name, `offset` pages. `shallow: true` means the API lives on an interface's members that are not listed, and the note says where to read them. For framework file/convention changes (not exported symbols), consult the official migration guide / Context7 instead.",
      annotations: READ_LIVE,
      inputSchema: {
        package: npmName.describe('npm package name'),
        version: z.string().optional().describe('Target version (defaults to latest)'),
        knownVersion: z
          .string()
          .optional()
          .describe('A version you already know; returns the API delta from it to the target'),
        query: z
          .string()
          .max(100)
          .optional()
          .describe('Part of a symbol name (case-insensitive); returns only matching symbols'),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Index of the first symbol to return, to page past the first 80'),
      },
    },
    async (args) => reply(await run('usage', () => handleUsage(db, args))),
  );

  server.registerTool(
    'diagram',
    {
      title: 'Reference architecture diagram',
      description:
        'Emit a reference-architecture Mermaid diagram for a stack you have already chosen (package names). A labeled starting point keyed by layer, not a validated architecture, and not an architecture designer.',
      annotations: READ_INDEX,
      inputSchema: {
        stack: z
          .array(npmName)
          .optional()
          .describe('Package names that make up the stack; omit or empty to get usage guidance'),
      },
    },
    async (args) => reply(await run('diagram', () => handleDiagram(db, args))),
  );

  server.registerTool(
    'resolve_surface',
    {
      title: 'Version-exact runtime surface',
      description:
        "What a package version ACTUALLY exports at runtime, extracted from its shipped JavaScript rather than from documentation or the model's memory: names and arity, not type signatures (use usage for those). Call before writing code against a package whose API may have moved. Runtime existence is what decides whether an import throws; a removed type breaks tsc, a removed runtime symbol breaks the program. A miss returns UNKNOWN and queues extraction, UNKNOWN never means the symbol is absent.",
      annotations: READ_LIVE,
      inputSchema: {
        package: npmName.describe('npm package name'),
        version: z.string().optional().describe('Exact version; omit for the latest extracted'),
      },
    },
    async (args) => reply(await run('resolve_surface', () => handleResolveSurface(db, args))),
  );

  server.registerTool(
    'diff_surface',
    {
      title: 'Surface diff between two versions',
      description:
        'What changed in a package\'s runtime surface between two versions: symbols removed, added, and arity changes, plus renames the package itself proves (a removed name that shared one declaration with a name the new version still exports). Removals break `node`; type-only removals are returned separately because they break `tsc` instead. Answers "when did this stop working" from static comparison, with no install required. Use before an upgrade, and to explain a break after one.',
      annotations: READ_LIVE,
      inputSchema: {
        package: npmName.describe('npm package name'),
        fromVersion: z.string().describe('Version you are on'),
        toVersion: z.string().describe('Version you are moving to'),
      },
    },
    async (args) => reply(await run('diff_surface', () => handleDiffSurface(db, args))),
  );

  server.registerTool(
    'mcp_stack',
    {
      title: 'Do these MCP servers coexist?',
      description:
        "Check whether a set of MCP servers can be wired into one agent together. The npm question does not apply — servers are separate processes with nothing to resolve between them. They clash in the single flat TOOL NAMESPACE the agent assembles from all of them: two servers exposing the same tool name leave the agent unable to express which it means, and nothing errors, one simply shadows the other. Also reports the standing context cost, since every tool's schema rides in every request. Pass `tools` for a server when you already hold its tool list (any server: remote, PyPI, Docker, private) and it is analysed as-is; otherwise the npm server's probed surface is used, and one that has not been probed makes the answer UNKNOWN, never clean.",
      annotations: READ_INDEX,
      inputSchema: {
        servers: z
          .array(
            z
              .object({
                server: z
                  .string()
                  .trim()
                  .min(1)
                  .max(300)
                  .describe('npm package name of the MCP server, or any label when `tools` is given'),
                version: z.string().max(100).nullable().optional(),
                tools: z
                  .array(
                    z.object({
                      name: z.string().min(1).max(256),
                      annotations: z.record(z.unknown()).optional(),
                    }),
                  )
                  .max(2000)
                  .optional()
                  .describe('The tool list as the agent received it; names and annotations are enough'),
              })
              .refine((s) => s.tools !== undefined || npmName.safeParse(s.server).success, {
                message: 'server must be an npm package name unless tools are given',
              }),
          )
          .min(1)
          .max(50)
          .describe('The servers configured into one agent'),
      },
    },
    async (args) =>
      reply(
        await run('mcp_stack', async () => {
          const { checkMcpStack } = await import('../compat/mcpStack');
          return checkMcpStack(
            db,
            args.servers.map((s) => ({
              server: s.server,
              version: s.version ?? null,
              tools: s.tools,
            })),
          );
        }),
      ),
  );

  server.registerTool(
    'mcp_surface',
    {
      title: "An MCP server's tool contract",
      description:
        "What an MCP server ACTUALLY exposes: every tool, its required and optional parameters, and its behaviour annotations, read from a live `tools/list` handshake in a sandbox rather than from a README or the model's memory. Call before wiring an agent to a server, or when a tool call is failing for reasons the error does not explain. Also returns `requires` — the API keys and settings the server declares it needs — and `configRequest`, a ready-made line to put in front of your user when something is missing, so 'it needs a token' never presents as 'it is broken'. A miss returns UNKNOWN and queues a probe; UNKNOWN never means the server has no tools.",
      annotations: READ_LIVE,
      inputSchema: {
        server: npmName.describe('npm package name of the MCP server'),
        version: z.string().optional().describe('Exact version; omit for the latest probed'),
      },
    },
    async (args) => reply(await run('mcp_surface', () => handleMcpSurface(db, args))),
  );

  server.registerTool(
    'mcp_drift',
    {
      title: 'MCP tool-contract drift between two versions',
      description:
        "What moved in an MCP server's tool contract between two versions: tools removed, parameters that became required, types narrowed, and annotation flips. Two findings here have no npm equivalent and are why this exists. SILENT DRIFT is a schema that changed while its description stayed byte-identical, invisible to anyone reading a changelog. PRIVILEGE WIDENING is a tool that stopped being read-only or started being destructive, which does not break anything and is worse than a break. Use before upgrading a server an agent depends on.",
      annotations: READ_INDEX,
      inputSchema: {
        server: npmName.describe('npm package name of the MCP server'),
        fromVersion: z.string().describe('Version you are on'),
        toVersion: z.string().describe('Version you are moving to'),
      },
    },
    async (args) => reply(await run('mcp_drift', () => handleMcpDrift(db, args))),
  );

  server.registerTool(
    'audit',
    {
      title: 'Audit a whole project',
      description:
        "Assess an entire project's dependencies in ONE call: which packages are outdated, deprecated or carry advisories for the exact installed version, and which configured MCP servers have drifted, need credentials, or cannot be observed at all. Send the inventory you read locally (names and versions only — never source). Returns a per-item verdict plus an explicit coverage count: how many were answered, how many are queued because the index has not seen them, and how many were skipped and why. An item lurq could not assess is reported as unassessed, never as clean.",
      annotations: READ_LIVE,
      inputSchema: {
        packages: z
          .array(
            z.object({
              name: npmName,
              range: z.string().optional().describe('Declared range, e.g. ^6.4.0'),
              installed: z
                .string()
                .nullable()
                .optional()
                .describe(
                  'Resolved version from the lockfile or node_modules — what actually runs',
                ),
            }),
          )
          .max(600)
          .optional()
          .describe('npm dependencies read from package.json + lockfile'),
        mcpServers: z
          .array(
            z.object({
              alias: z.string().max(200).optional(),
              kind: z
                .enum(['npm-stdio', 'remote', 'local', 'other-registry'])
                .optional()
                .describe('How it launches; decides whether lurq can read its contract'),
              packageName: z.string().max(300).nullable().optional(),
              version: z.string().max(100).nullable().optional(),
              endpoint: z.string().max(300).nullable().optional(),
            }),
          )
          .max(200)
          .optional()
          .describe('MCP servers read from .mcp.json / agent configs'),
      },
    },
    async (args) => reply(await run('audit', () => handleAudit(db, args, ctx.ownerId ?? null))),
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
      annotations: READ_INDEX,
      inputSchema: {
        query: z
          .string()
          .max(300)
          .optional()
          .describe('What you are trying to do, in plain words. Omit for the full menu.'),
      },
    },
    async (args) => reply({ capabilities: searchCapabilities(args.query ?? '', 6) }),
  );

  server.registerTool(
    'report_outcome',
    {
      title: 'Report how a package worked out',
      description:
        "Opt-in feedback after you act on lurq's evidence about a package (verify, evaluate, compare, compat): whether you went with it and whether it built. No source code, only the coarse decision + a build signal. Helps lurq learn which packages agents actually succeed with; safe to skip.",
      // The one tool that writes: each call appends a row, so a repeat is a
      // second report, not a no-op.
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        package: npmName.describe('The package you decided on'),
        accepted: z.boolean().describe('Did you go with this package?'),
        buildSignal: z
          .enum(['installed', 'compiled', 'tests_passed', 'failed'])
          .optional()
          .describe('Coarse post-install result, if known'),
        need: z
          .string()
          .max(500)
          .optional()
          .describe('What you needed the package for, in plain words (no source code)'),
      },
    },
    // ownerId comes from the authenticated key (ctx), NOT the tool arguments —
    // a caller must never be able to attribute an outcome to another org.
    async (args) =>
      reply(await run('report_outcome', () => handleReportOutcome(db, args, ctx.ownerId ?? null))),
  );

  // lurq has tools and nothing else, and the SDK answers resources/list,
  // resources/templates/list and prompts/list for a server that registered none
  // with "Method not found". Directory scanners call all three whatever the
  // capabilities say, and Smithery reports each as a failed scan step, so the
  // honest answer, "none", is declared instead.
  //
  // ponytail: empty lists. The first real resource or prompt must delete the
  // matching handler here: McpServer installs its own on registration and
  // refuses if one already exists.
  server.server.registerCapabilities({ resources: {}, prompts: {} });
  server.server.setRequestHandler(ListResourcesRequestSchema, () => ({ resources: [] }));
  server.server.setRequestHandler(ListResourceTemplatesRequestSchema, () => ({ resourceTemplates: [] }));
  server.server.setRequestHandler(ListPromptsRequestSchema, () => ({ prompts: [] }));

  return server;
}

/**
 * Why `lurq serve` will not start, in words a user can act on.
 *
 * Failing before the handshake was chosen over starting with DB-backed tools
 * erroring one call at a time. A server that connects looks healthy in the
 * client's MCP list, and several handlers deliberately swallow a failed index
 * read and degrade (`verify` answers without its typosquat corpus, for one), so
 * an agent could get an answer that is quietly missing a safety signal. This
 * message lands in the client's MCP server log, which is where a user looks
 * when a server shows as failed.
 */
export const SERVE_NEEDS_DATABASE =
  '`lurq serve` answers from a local lurq index and needs DATABASE_URL, which is not set. ' +
  'To use lurq from an agent without running your own index, connect it to the hosted service instead: ' +
  'run `npx lurqrun` and it writes the MCP entry for your assistants. ' +
  'To self-host, set DATABASE_URL to a migrated lurq index.';

export async function startMcpServer(): Promise<void> {
  if (!getConfig().DATABASE_URL) throw new Error(SERVE_NEEDS_DATABASE);
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
