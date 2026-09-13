/**
 * `mcp_surface` and `mcp_drift` — the tool-contract half of §8.1.
 *
 * Same two questions `resolve_surface` and `diff_surface` answer for npm, asked
 * of a different unit: what does this thing expose, and what moved. Same
 * response discipline — every answer carries `verdict`, `class`, `tier`,
 * `observedAt` and a coverage note, because a bare answer with no provenance is
 * indistinguishable from the model's own guess.
 *
 * One rule is STRICTER here than on the npm path. `resolve_surface` relaxed
 * "never extract inside a query" because a tarball read is sub-second and can be
 * budgeted. A probe cannot: it installs a package and handshakes with someone
 * else's program over stdio, with a 45-second ceiling. So a miss here always
 * queues and answers UNKNOWN, and never blocks the caller.
 */
import { createHash } from 'node:crypto';
import { cached } from '../core/cache';
import type { Database } from '../db/client';
import { enqueueSurface } from '../db/surface';
import type { Verdict } from '../graph/types';
import {
  contractOf,
  diffMcpSurfaces,
  MCP_TIER,
  type AnnotationHint,
  type McpDrift,
  summarizeDrift,
} from '../surface/mcp';
import {
  configRequestLine,
  fetchServerManifest,
  missingConfig,
  type RequiredConfig,
} from '../surface/mcpRegistry';
import { loadStored, rowsToSurface, type StoredSurface } from './surfaceHandlers';

export interface McpSurfaceInput {
  server: string;
  version?: string | null;
}

export interface McpToolView {
  name: string;
  /** Parameters a caller MUST pass. */
  required: string[];
  /** Every top-level parameter the tool accepts. */
  params: string[];
  annotations: Record<AnnotationHint, boolean>;
  /** The tool declares a structured result an agent can parse. */
  hasOutputSchema: boolean;
  deprecated: boolean;
}

export interface McpSurfaceResponse {
  server: string;
  version: string | null;
  verdict: Verdict;
  class: 'declared' | 'executed' | 'derived' | null;
  tier: string | null;
  tools: McpToolView[];
  /**
   * Settings the server declares it needs. Present whether or not the probe
   * succeeded: an agent wiring up a working server still has to know it wants a
   * token before the first call fails in front of a user.
   */
  requires: RequiredConfig[];
  /**
   * A ready-made request an agent can put in front of its user when `requires`
   * contains something the environment does not have. Null when nothing is
   * missing. Names the settings and why; never contains a value.
   */
  configRequest: string | null;
  coverageNote: string;
  observedAt: string | null;
}

/** Short stable cache key. */
function ckey(parts: unknown): string {
  return createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 24);
}

const MISS = (server: string, version: string | null): McpSurfaceResponse => ({
  server,
  version,
  verdict: 'unknown',
  class: null,
  tier: null,
  tools: [],
  requires: [],
  configRequest: null,
  coverageNote:
    'not yet probed, queued; retry shortly. This is NOT evidence that the server exposes no tools.',
  observedAt: null,
});

/** Stored rows → the view an agent reads. */
function toolViews(stored: StoredSurface): McpToolView[] {
  const surface = rowsToSurface('', null, stored.rows, MCP_TIER);
  return surface.symbols
    .map((s) => {
      const c = contractOf(s);
      const input = (c?.input ?? null) as Record<string, unknown> | null;
      const props = input && typeof input.properties === 'object' ? input.properties : {};
      const required = Array.isArray(input?.required) ? (input.required as string[]) : [];
      return {
        name: s.path,
        required: [...required].sort(),
        params: Object.keys(props ?? {}).sort(),
        annotations: c?.annotations ?? {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: true,
        },
        hasOutputSchema: c?.output != null,
        deprecated: s.deprecated,
      };
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export async function handleMcpSurface(
  db: Database,
  input: McpSurfaceInput,
): Promise<McpSurfaceResponse> {
  return cached(
    'mcp_surface',
    ckey([input.server, input.version ?? null]),
    () => mcpSurfaceUncached(db, input),
    { skipCache: (v) => v.verdict === 'unknown' },
  );
}

async function mcpSurfaceUncached(
  db: Database,
  input: McpSurfaceInput,
): Promise<McpSurfaceResponse> {
  const version = input.version ?? null;
  const [stored, manifest] = await Promise.all([
    loadStored(db, input.server, version, 0, 'mcp_server'),
    // Best-effort and never fatal: the registry being down must not change what
    // we say about a server.
    fetchServerManifest(input.server).catch(() => null),
  ]);

  const requires = manifest?.env ?? [];
  const missing = missingConfig(manifest);
  const configRequest = missing.length ? configRequestLine(input.server, missing) : null;
  const base = { server: input.server, version, requires, configRequest };

  // Declared settings we do not have. Reported BEFORE anything else and without
  // queueing: a probe would fail for a reason that says nothing about the
  // server, and the honest answer — plus the request an agent can act on — is
  // already available from the manifest.
  if (missing.length > 0 && (!stored || stored.rows.length === 0)) {
    return {
      ...base,
      verdict: 'unverifiable',
      class: null,
      tier: null,
      tools: [],
      coverageNote:
        'server declares required settings this environment does not have, so it was not probed. UNVERIFIABLE, not a fault: nothing here is evidence about whether the server works. Supply the values in `requires` and ask again.',
      observedAt: null,
    };
  }

  if (manifest?.remoteOnly) {
    return {
      ...base,
      verdict: 'unverifiable',
      class: null,
      tier: null,
      tools: [],
      coverageNote: `server is published only as a remote ${manifest.transport ?? 'endpoint'}; there is no package to install, so this stdio probe does not apply to it`,
      observedAt: null,
    };
  }

  // Probed, and it would not run. A settled negative, so it is reported as one
  // rather than re-queueing a 45-second probe of a server already known broken.
  if (stored?.verdict === 'verified_false') {
    return {
      ...base,
      verdict: 'verified_false',
      class: stored.class,
      tier: stored.tier,
      tools: [],
      coverageNote:
        'server was probed and did not complete the MCP handshake, so it exposes no callable tools in a clean install. This is a verdict about the server, not a gap in our coverage.',
      observedAt: stored.observedAt,
    };
  }

  if (!stored || stored.rows.length === 0) {
    // Probing is a sandbox spawn — queue it, never run it here.
    await enqueueSurface(db, input.server, version, 'mcp_server').catch(() => {});
    return { ...MISS(input.server, version), requires, configRequest };
  }

  if (stored.verdict === 'undeclared') {
    return {
      ...base,
      verdict: 'undeclared',
      class: stored.class,
      tier: stored.tier,
      tools: [],
      coverageNote:
        'server started and completed the handshake but listed no tools; UNDECLARED, which is a measurement gap, not proof it has none',
      observedAt: stored.observedAt,
    };
  }

  const tools = toolViews(stored);
  const noContract = tools.filter((t) => t.params.length === 0 && t.required.length === 0).length;

  return {
    ...base,
    verdict: stored.verdict,
    class: stored.class,
    tier: stored.tier,
    tools,
    coverageNote:
      `${tools.length} tool(s) read from tools/list` +
      (noContract
        ? `; ${noContract} declare no input parameters (either genuinely nullary, or probed before schemas were captured)`
        : '') +
      (requires.length
        ? `; the server declares ${requires.length} setting(s) in \`requires\` that a caller must supply`
        : '') +
      '. Declared contract only: that a tool is listed is not evidence that calling it succeeds.',
    observedAt: stored.observedAt,
  };
}

export interface McpDriftInput {
  server: string;
  fromVersion: string;
  toVersion: string;
}

export interface McpDriftResponse extends Omit<McpDrift, 'tier'> {
  verdict: Verdict;
  class: 'derived' | null;
  tier: string;
  /** One line an agent can act on without reading the arrays. */
  summary: string;
  observedAt: string | null;
}

export async function handleMcpDrift(
  db: Database,
  input: McpDriftInput,
): Promise<McpDriftResponse> {
  return cached(
    'mcp_drift',
    ckey([input.server, input.fromVersion, input.toVersion]),
    () => mcpDriftUncached(db, input),
    { skipCache: (v) => v.verdict === 'unknown' },
  );
}

// Pure, so the CLI scan can use it without the database layer.
export { summarizeDrift as summarize };

async function mcpDriftUncached(db: Database, input: McpDriftInput): Promise<McpDriftResponse> {
  const [a, b] = await Promise.all([
    loadStored(db, input.server, input.fromVersion, 0, 'mcp_server'),
    loadStored(db, input.server, input.toVersion, 0, 'mcp_server'),
  ]);

  const missing: string[] = [];
  if (!a || a.rows.length === 0) missing.push(input.fromVersion);
  if (!b || b.rows.length === 0) missing.push(input.toVersion);

  if (missing.length) {
    for (const v of missing) {
      await enqueueSurface(db, input.server, v, 'mcp_server').catch(() => {});
    }
    const blank = diffMcpSurfaces(
      {
        package: input.server,
        version: input.fromVersion,
        tier: MCP_TIER,
        entry: null,
        symbols: [],
        filesWalked: 0,
        externalReExports: [],
      },
      {
        package: input.server,
        version: input.toVersion,
        tier: MCP_TIER,
        entry: null,
        symbols: [],
        filesWalked: 0,
        externalReExports: [],
      },
    );
    return {
      ...blank,
      inconclusive: `no probed surface for ${missing.join(', ')}, queued; retry shortly. NOT evidence that tools were removed.`,
      verdict: 'unknown',
      class: null,
      summary: 'unknown: not yet probed',
      observedAt: null,
    };
  }

  const drift = diffMcpSurfaces(
    rowsToSurface(input.server, input.fromVersion, a!.rows, MCP_TIER),
    rowsToSurface(input.server, input.toVersion, b!.rows, MCP_TIER),
  );

  return {
    ...drift,
    verdict: (drift.inconclusive ? 'unknown' : 'verified_true') as Verdict,
    class: drift.inconclusive ? null : ('derived' as const),
    summary: drift.inconclusive ?? summarizeDrift(drift),
    observedAt: b!.observedAt,
  };
}
