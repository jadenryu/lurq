/**
 * MCP tool-surface drain — the `mcp_server` half of the surface queue.
 *
 * Structurally the same as `./surface.ts` (drain → extract → store → backfill
 * the predecessor so the pair is diffable) with one difference that drives every
 * design choice here: extraction is not a download, it is a sandbox spawn plus
 * an stdio handshake with someone else's program. That costs seconds, not
 * milliseconds, so this drain runs at a much smaller per-cycle budget and leans
 * far harder on the content-addressed cache.
 *
 * `surfaceHash` stands in for the tarball digest. It is a strictly better cache
 * key than npm's, because a published tarball is immutable while a tool list is
 * not: the same `name@version` can hand back a different contract tomorrow, and
 * a changed hash on an unchanged version IS the drift signal rather than merely
 * a cache miss.
 *
 * Failure handling follows §4.2: infrastructure problems bump the attempt count
 * and leave the spec queued, they never record a verdict about the server.
 */
import { formatError } from '../core/errors';
import { logger } from '../core/logger';
import type { Database } from '../db/client';
import { getPackageVersions } from '../db/packages';
import {
  bumpSurfaceAttempt,
  dropSurfaceQueue,
  enqueuePreviousSurface,
  enqueueSurface,
  getPendingSurfaces,
  isExtractionCached,
  mcpSurfaceRef,
  storeSurface,
} from '../db/surface';
import { probeMcpServer, mcpServerOracle } from '../graph/oracles/mcpServer';
import { getSandbox } from '../sandbox/index';
import type { Sandbox } from '../sandbox/types';
import { MCP_TIER, mcpSurface, surfaceHash, type McpTool } from '../surface/mcp';

/** See `./surface.ts` — the timeline is newest-first and releases arrive in bursts. */
const VERSION_LOOKBACK = 50;

/**
 * Bumped whenever probing can produce a different answer for the same server.
 * '1' is the first version that captures full tool schemas and drains every
 * `tools/list` page; anything stored before that is a name-only list and is
 * treated as stale rather than reused.
 */
const EXTRACTOR_VERSION = '1';
const MAX_ATTEMPTS = 3;

/**
 * Far below the npm drain's budget, and deliberately.
 *
 * Each item here installs a package and runs a foreign program to handshake
 * timeout (45s worst case). Ten per cycle would let one slow server stall the
 * whole worker loop.
 */
export const MCP_PER_CYCLE = 3;

export type McpOutcome =
  | 'stored'
  | 'cached'
  /** Server listed no tools — a measurement gap, recorded as UNDECLARED. */
  | 'undeclared'
  /** Server would not start or refused the handshake. Evidence about the server. */
  | 'unreachable'
  /** The list was still paginating at the ceiling; NOT a surface. */
  | 'truncated';

export interface McpExtractResult {
  outcome: McpOutcome;
  tools: McpTool[];
  /** Why the probe produced no usable surface. Null on success. */
  reason: string | null;
}

/**
 * Probe one MCP server and persist its tool surface.
 *
 * `unreachable` and `truncated` both return WITHOUT storing anything. Writing an
 * empty surface for a server that failed to boot would make the next successful
 * probe diff against nothing and report every tool as newly added — and, worse,
 * would let a later reader mistake "we could not start it" for "it exposes no
 * tools". The two are not the same claim and this pipeline never conflates them.
 */
export async function extractAndStoreMcp(
  db: Database,
  server: string,
  version: string | null,
  opts: { sandbox?: Sandbox } = {},
): Promise<McpExtractResult> {
  const sandbox = opts.sandbox ?? (await getSandbox());
  const { probe, stderr } = await probeMcpServer(sandbox, server, version);

  if (!probe) {
    return { outcome: 'unreachable', tools: [], reason: `no probe output: ${stderr.slice(0, 200)}` };
  }
  if (!probe.ok) {
    return {
      outcome: 'unreachable',
      tools: [],
      reason: `stage=${probe.stage} ${probe.error ?? ''}`.slice(0, 300),
    };
  }
  if (probe.truncated) {
    return {
      outcome: 'truncated',
      tools: probe.tools ?? [],
      reason: 'tools/list still paginating at the page ceiling; list incomplete',
    };
  }

  const tools = probe.tools ?? [];
  const ref = mcpSurfaceRef(server, version);
  const hash = surfaceHash(tools);

  if (await isExtractionCached(db, ref, hash, EXTRACTOR_VERSION, MCP_TIER)) {
    return { outcome: 'cached', tools, reason: null };
  }

  const res = await storeSurface(db, mcpSurface(server, version, tools), {
    artifactHash: hash,
    extractorVersion: EXTRACTOR_VERSION,
    ref,
    oracleId: mcpServerOracle.id,
  });

  return {
    outcome: res.verdict === 'undeclared' ? 'undeclared' : 'stored',
    tools,
    reason: res.verdict === 'undeclared' ? 'server listed no tools' : null,
  };
}

export interface McpDrainSummary {
  drained: number;
  stored: number;
  cached: number;
  undeclared: number;
  unreachable: number;
  truncated: number;
  failed: number;
  /** Predecessor versions queued so this one becomes diffable. */
  backfilled: number;
}

export async function drainMcpQueue(
  db: Database,
  opts: { limit?: number; sandbox?: Sandbox } = {},
): Promise<McpDrainSummary> {
  const pending = await getPendingSurfaces(db, opts.limit ?? MCP_PER_CYCLE, 'mcp_server');
  const s: McpDrainSummary = {
    drained: 0,
    stored: 0,
    cached: 0,
    undeclared: 0,
    unreachable: 0,
    truncated: 0,
    failed: 0,
    backfilled: 0,
  };

  for (const item of pending) {
    s.drained++;
    try {
      const { outcome, reason } = await extractAndStoreMcp(db, item.packageName, item.version, {
        sandbox: opts.sandbox,
      });
      s[outcome]++;

      if (reason) {
        logger.info(
          { server: item.packageName, version: item.version, outcome, reason },
          'mcp: no surface stored',
        );
      }

      // Pull the predecessor in behind a successful read, for the same reason
      // the npm drain does: one surface says what a server exposes, only a pair
      // says what a release took away.
      if (item.version && (outcome === 'stored' || outcome === 'cached')) {
        await enqueuePreviousSurface(
          db,
          item.packageName,
          item.version,
          await getPackageVersions(db, item.packageName, VERSION_LOOKBACK),
          'mcp_server',
        ).then(
          (queued) => {
            if (queued) s.backfilled++;
          },
          (err) =>
            logger.warn(
              { server: item.packageName, err: formatError(err) },
              'mcp: predecessor backfill could not be queued',
            ),
        );
      }

      // A server that cannot start is a settled answer about that version, not
      // a transient one — drop it rather than retrying the same failure every
      // cycle. A truncated list, by contrast, means our own ceiling was too low.
      await dropSurfaceQueue(db, item.id);
    } catch (err) {
      s.failed++;
      // The sandbox itself failed. Never a verdict about the server (§4.2).
      if (item.attempts + 1 >= MAX_ATTEMPTS) await dropSurfaceQueue(db, item.id);
      else await bumpSurfaceAttempt(db, item.id);
      logger.warn(
        { spec: item.specKey, attempts: item.attempts + 1, err: formatError(err) },
        'mcp surface probe failed',
      );
    }
  }
  return s;
}

/** Queue an MCP server for probing. Thin wrapper so callers never pass the kind. */
export async function enqueueMcpServer(
  db: Database,
  server: string,
  version: string | null,
): Promise<void> {
  await enqueueSurface(db, server, version, 'mcp_server');
}
