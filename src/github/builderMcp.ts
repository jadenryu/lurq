/**
 * The MCP half of a builder profile: the MCP servers a person's repos commit to
 * their agents' configs, and the repos that are MCP servers themselves.
 *
 * Evidence only, and all of it public:
 *   - configs are the files a repo commits (`.mcp.json`, `.cursor/mcp.json`,
 *     `.vscode/mcp.json`), parsed by the same code `lurq audit` uses;
 *   - a repo is an MCP server when its package.json depends on the SDK and ships
 *     something runnable, or its root server.json names an npm package;
 *   - what a server exposes comes from lurq's shared index of probed surfaces,
 *     the same answer `mcp_surface` gives an agent.
 *
 * What lurq cannot read is named, never guessed at. A remote endpoint, a PyPI or
 * Docker server and a local command are listed with that label, and an npm server
 * nobody has probed is queued and says so. Env var values are never read; the
 * required settings shown are names from the MCP registry.
 *
 * Reads and surface lookups are passed in, so this runs in tests without GitHub
 * or a database.
 */
import { serversFromConfig } from '../audit/inventory';
import type { InventoryMcpServer, McpKind } from '../audit/types';
import { analyzeStack, type StackMemberInput } from '../compat/mcpStack';
import type { McpSurfaceResponse } from '../mcp/mcpHandlers';
import type { RegistryServer } from '../surface/mcpRegistry';
import type { GitHubRead } from './publicScan';

export const MCP_CONFIG_FILES = ['.mcp.json', '.cursor/mcp.json', '.vscode/mcp.json'] as const;
export const SDK_PACKAGE = '@modelcontextprotocol/sdk';

/** Surface lookups per profile. Each can reach the MCP registry; past this a server is listed as not checked. */
export const MAX_SURFACE_LOOKUPS = 20;

/**
 * Tools carried per server. The counts above the list stay exact; this bounds
 * the payload for a server with a hundred tools, which no reader opens anyway.
 * Tools arrive sorted by name, so the cap keeps a stable slice.
 */
export const TOOLS_SHOWN = 40;

/** One tool's schema, as the server declared it at the handshake. */
export interface McpToolDetail {
  name: string;
  /** Parameters a caller must pass. */
  required: string[];
  /** Every top-level parameter the tool accepts. */
  params: string[];
  readOnly: boolean;
  /** By the tool's own annotation. The spec default is destructive, so silence counts as yes. */
  destructive: boolean;
  /** The tool declares a structured result, so an agent can parse it rather than read prose. */
  output: boolean;
  deprecated: boolean;
}

export type McpServerStatus =
  | 'probed'
  | 'queued'
  | 'handshake-failed'
  | 'needs-config'
  | 'undeclared'
  | 'remote-only'
  | 'not-probed';

export interface ProfileMcpServer {
  /** The config key, or the package name for a repo that is a server. */
  alias: string;
  kind: McpKind;
  packageName: string | null;
  /** Host, for a remote server. */
  endpoint: string | null;
  status: McpServerStatus;
  /** Tool counts, by the tools' own annotations. Zero unless `probed`. */
  tools: number;
  writes: number;
  destroys: number;
  /** Settings the MCP registry says the server requires. Names only, never values. */
  requiredConfig: string[];
  /** What each probed tool takes and returns. Empty unless `probed`; capped at TOOLS_SHOWN. */
  toolDetail: McpToolDetail[];
}

export interface ProfileMcpConfig {
  repo: string;
  files: string[];
  servers: ProfileMcpServer[];
  /** Tool names more than one probed server exposes: the agent cannot say which it means. */
  collisions: { tool: string; servers: string[]; writes: boolean }[];
  /** Null when any server in the config is unread, so the total is not known. */
  totalTools: number | null;
  estimatedContextTokens: number | null;
}

export interface ProfileMcpBuild extends ProfileMcpServer {
  repo: string;
}

export interface ProfileMcp {
  configs: ProfileMcpConfig[];
  builds: ProfileMcpBuild[];
  /** Config or server.json reads GitHub did not answer (not 404s): servers in them are missing. */
  unreadFiles: number;
}

/** What the report says about a server, from the surface answer. */
export function statusFrom(s: McpSurfaceResponse): McpServerStatus {
  switch (s.verdict) {
    case 'unknown':
      return 'queued';
    case 'verified_false':
      return 'handshake-failed';
    case 'undeclared':
      return 'undeclared';
    case 'unverifiable':
      return s.configRequest ? 'needs-config' : 'remote-only';
    default:
      return s.tools.length > 0 ? 'probed' : 'undeclared';
  }
}

/**
 * The npm package a repo publishes as an MCP server, or null.
 *
 * Needs the SDK as a runtime dependency plus something runnable (`bin` or an
 * `mcpName`), and not `private`: a dev dependency on the SDK is usually a client
 * or a test. Failing that, a root server.json that names an npm package.
 */
export function serverPackage(manifest: unknown, serverJson: unknown): string | null {
  if (manifest && typeof manifest === 'object') {
    const m = manifest as Record<string, unknown>;
    const hasSdk = [m.dependencies, m.peerDependencies].some(
      (d) => !!d && typeof d === 'object' && SDK_PACKAGE in (d as Record<string, unknown>),
    );
    const runnable = Boolean(m.bin) || typeof m.mcpName === 'string';
    if (hasSdk && runnable && typeof m.name === 'string' && m.private !== true) return m.name;
  }
  if (serverJson && typeof serverJson === 'object') {
    const pkg = ((serverJson as RegistryServer).packages ?? []).find(
      (p) => p.registryType === 'npm' && typeof p.identifier === 'string' && p.identifier.length > 0,
    );
    if (pkg?.identifier) return pkg.identifier;
  }
  return null;
}

const unprobed = (base: Pick<ProfileMcpServer, 'alias' | 'kind' | 'packageName' | 'endpoint'>): ProfileMcpServer => ({
  ...base,
  status: 'not-probed',
  tools: 0,
  writes: 0,
  destroys: 0,
  requiredConfig: [],
  toolDetail: [],
});

function fromSurface(
  base: Pick<ProfileMcpServer, 'alias' | 'kind' | 'packageName' | 'endpoint'>,
  s: McpSurfaceResponse,
): ProfileMcpServer {
  const status = statusFrom(s);
  const tools = status === 'probed' ? s.tools : [];
  return {
    ...base,
    status,
    tools: tools.length,
    // Annotations carry the spec defaults: a tool that declares nothing is assumed to write and destroy.
    writes: tools.filter((t) => !t.annotations.readOnlyHint).length,
    destroys: tools.filter((t) => t.annotations.destructiveHint).length,
    requiredConfig: s.requires.filter((r) => r.required).map((r) => r.name),
    toolDetail: tools.slice(0, TOOLS_SHOWN).map((t) => ({
      name: t.name,
      required: t.required,
      params: t.params,
      readOnly: t.annotations.readOnlyHint,
      destructive: t.annotations.destructiveHint,
      output: t.hasOutputSchema,
      deprecated: t.deprecated,
    })),
  };
}

export interface McpReadDeps {
  /** A file at the root of one of the owner's repos. */
  read: (repo: string, path: string) => Promise<GitHubRead<unknown>>;
  /** The indexed surface of an npm-published MCP server. */
  surface: (server: string) => Promise<McpSurfaceResponse>;
}

export async function profileMcp(
  owner: string,
  repos: { name: string; manifest: unknown }[],
  deps: McpReadDeps,
): Promise<ProfileMcp> {
  const wanted = [...MCP_CONFIG_FILES, 'server.json'];
  const reads = await Promise.all(
    repos.map(async (repo) => ({
      repo,
      files: await Promise.all(wanted.map(async (path) => ({ path, read: await deps.read(repo.name, path) }))),
    })),
  );

  const lookups = new Map<string, Promise<McpSurfaceResponse | null>>();
  const surfaceOf = (pkg: string): Promise<McpSurfaceResponse | null> => {
    const known = lookups.get(pkg);
    if (known) return known;
    if (lookups.size >= MAX_SURFACE_LOOKUPS) return Promise.resolve(null);
    const pending = deps.surface(pkg).catch(() => null);
    lookups.set(pkg, pending);
    return pending;
  };

  let unreadFiles = 0;
  const configs: ProfileMcpConfig[] = [];
  const builds: ProfileMcpBuild[] = [];

  for (const { repo, files } of reads) {
    const full = `${owner}/${repo.name}`;
    const found: string[] = [];
    const declared: InventoryMcpServer[] = [];
    let serverJson: unknown = null;
    for (const f of files) {
      if (!f.read.data) {
        if (f.read.status !== 404) unreadFiles++;
        continue;
      }
      if (f.path === 'server.json') {
        serverJson = f.read.data;
        continue;
      }
      found.push(f.path);
      declared.push(...serversFromConfig(f.read.data, f.path));
    }

    if (found.length > 0) {
      // One server committed for two editors is one server, not two, and never a collision with itself.
      const seen = new Set<string>();
      const servers = declared.filter((s) => {
        const key = `${s.alias}|${s.packageName ?? s.endpoint ?? ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const surfaces = await Promise.all(
        servers.map((s) => (s.kind === 'npm-stdio' && s.packageName ? surfaceOf(s.packageName) : Promise.resolve(null))),
      );
      const views = servers.map((s, i) => {
        const base = { alias: s.alias, kind: s.kind, packageName: s.packageName, endpoint: s.endpoint };
        return surfaces[i] ? fromSurface(base, surfaces[i]) : unprobed(base);
      });
      const inputs: StackMemberInput[] = servers.map((s, i) => ({
        server: s.packageName ?? s.alias,
        version: null,
        tools:
          views[i]!.status === 'probed'
            ? surfaces[i]!.tools.map((t) => ({ name: t.name, annotations: t.annotations }))
            : null,
      }));
      const stack = analyzeStack(inputs);
      configs.push({
        repo: full,
        files: found,
        servers: views,
        collisions: stack.collisions,
        totalTools: stack.totalTools,
        estimatedContextTokens: stack.estimatedContextTokens,
      });
    }

    const pkg = serverPackage(repo.manifest, serverJson);
    if (pkg) {
      const base = { alias: pkg, kind: 'npm-stdio' as McpKind, packageName: pkg, endpoint: null };
      const surface = await surfaceOf(pkg);
      builds.push({ repo: full, ...(surface ? fromSurface(base, surface) : unprobed(base)) });
    }
  }

  return { configs, builds, unreadFiles };
}
