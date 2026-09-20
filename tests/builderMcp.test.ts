/**
 * Pinned: the MCP section reports only what configs and lurq's index show. A
 * server committed for two editors is listed once, what lurq cannot probe says
 * so, a failed read is counted instead of looking like no config, and a repo is
 * called an MCP server only on real evidence.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  profileMcp,
  serverPackage,
  statusFrom,
  TOOLS_SHOWN,
  type McpReadDeps,
} from '../src/github/builderMcp';
import type { McpSurfaceResponse } from '../src/mcp/mcpHandlers';

const ann = (readOnly: boolean, destructive = false) => ({
  readOnlyHint: readOnly,
  destructiveHint: destructive,
  idempotentHint: false,
  openWorldHint: true,
});

const surface = (over: Partial<McpSurfaceResponse> = {}): McpSurfaceResponse =>
  ({
    server: 'pkg',
    version: null,
    verdict: 'verified_true',
    class: 'executed',
    tier: 'mcp_tools_list',
    tools: [],
    requires: [],
    configRequest: null,
    coverageNote: '',
    observedAt: null,
    ...over,
  }) as McpSurfaceResponse;

const tool = (name: string, readOnly: boolean, destructive = false) => ({
  name,
  required: [],
  params: [],
  annotations: ann(readOnly, destructive),
  hasOutputSchema: false,
  deprecated: false,
});

const ok = (data: unknown) => ({ data, status: 200, link: null });
const missing = { data: null, status: 404, link: null };
const failed = { data: null, status: 0, link: null };

describe('statusFrom', () => {
  it('maps each surface verdict to what the report may say', () => {
    expect(statusFrom(surface({ verdict: 'unknown' } as never))).toBe('queued');
    expect(statusFrom(surface({ verdict: 'verified_false' } as never))).toBe('handshake-failed');
    expect(statusFrom(surface({ verdict: 'undeclared' } as never))).toBe('undeclared');
    expect(
      statusFrom(
        surface({ verdict: 'unverifiable', configRequest: 'needs GITHUB_TOKEN' } as never),
      ),
    ).toBe('needs-config');
    expect(statusFrom(surface({ verdict: 'unverifiable' } as never))).toBe('remote-only');
    expect(statusFrom(surface({ tools: [tool('a', true)] }))).toBe('probed');
  });
});

describe('serverPackage', () => {
  it('needs the SDK at runtime, something runnable, and a public package', () => {
    const base = {
      name: '@ada/weather-mcp',
      dependencies: { '@modelcontextprotocol/sdk': '^1.0.0' },
    };
    expect(serverPackage({ ...base, bin: { weather: 'dist/index.js' } }, null)).toBe(
      '@ada/weather-mcp',
    );
    expect(serverPackage({ ...base, mcpName: 'io.github.ada/weather' }, null)).toBe(
      '@ada/weather-mcp',
    );
    expect(serverPackage(base, null)).toBeNull();
    expect(serverPackage({ ...base, bin: 'x', private: true }, null)).toBeNull();
    expect(
      serverPackage(
        { name: 'client', devDependencies: { '@modelcontextprotocol/sdk': '^1' }, bin: 'x' },
        null,
      ),
    ).toBeNull();
  });

  it('falls back to an npm package named in server.json', () => {
    expect(
      serverPackage(null, {
        packages: [
          { registryType: 'pypi', identifier: 'x' },
          { registryType: 'npm', identifier: 'ada-mcp' },
        ],
      }),
    ).toBe('ada-mcp');
    expect(serverPackage(null, { remotes: [{ url: 'https://x' }] })).toBeNull();
  });
});

describe('profileMcp', () => {
  const mcpJson = {
    mcpServers: {
      github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
      linear: { url: 'https://mcp.linear.app/mcp' },
      search: { command: 'npx', args: ['-y', 'search-mcp'] },
      py: { command: 'uvx', args: ['mcp-server-fetch'] },
    },
  };
  const cursorJson = {
    mcpServers: { github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] } },
  };

  const deps = (): McpReadDeps => ({
    read: vi.fn(async (repo: string, path: string) => {
      if (repo === 'app' && path === '.mcp.json') return ok(mcpJson);
      if (repo === 'app' && path === '.cursor/mcp.json') return ok(cursorJson);
      if (repo === 'app' && path === '.vscode/mcp.json') return failed;
      return missing;
    }),
    surface: vi.fn(async (server: string) => {
      if (server === '@modelcontextprotocol/server-github') {
        return surface({
          tools: [
            tool('search', true),
            tool('create_issue', false),
            tool('delete_repo', false, true),
          ],
        });
      }
      if (server === 'search-mcp') return surface({ tools: [tool('search', true)] });
      if (server === '@ada/weather-mcp') return surface({ verdict: 'unknown' } as never);
      return surface({ verdict: 'unknown' } as never);
    }),
  });

  it('lists each committed server once, with what lurq knows and what it cannot probe', async () => {
    const d = deps();
    const mcp = await profileMcp('ada', [{ name: 'app', manifest: null }], d);
    expect(mcp.configs).toHaveLength(1);
    const config = mcp.configs[0]!;
    expect(config.files).toEqual(['.mcp.json', '.cursor/mcp.json']);
    expect(config.servers.map((s) => s.alias)).toEqual(['github', 'linear', 'search', 'py']);
    // The same server in two files is looked up once.
    expect(
      vi.mocked(d.surface).mock.calls.filter(([s]) => s === '@modelcontextprotocol/server-github'),
    ).toHaveLength(1);

    const byAlias = Object.fromEntries(config.servers.map((s) => [s.alias, s]));
    expect(byAlias.github).toMatchObject({ status: 'probed', tools: 3, writes: 2, destroys: 1 });
    // The schema of each tool, for the drawer: what it takes and what it may do.
    expect(byAlias.github!.toolDetail).toEqual([
      {
        name: 'search',
        required: [],
        params: [],
        readOnly: true,
        destructive: false,
        output: false,
        deprecated: false,
      },
      {
        name: 'create_issue',
        required: [],
        params: [],
        readOnly: false,
        destructive: false,
        output: false,
        deprecated: false,
      },
      {
        name: 'delete_repo',
        required: [],
        params: [],
        readOnly: false,
        destructive: true,
        output: false,
        deprecated: false,
      },
    ]);
    expect(byAlias.linear!.toolDetail).toEqual([]);
    expect(byAlias.linear).toMatchObject({
      kind: 'remote',
      status: 'not-probed',
      endpoint: 'mcp.linear.app',
    });
    expect(byAlias.py).toMatchObject({ kind: 'other-registry', status: 'not-probed' });

    // `search` is exposed by two probed servers; totals are unknown because two servers are unread.
    expect(config.collisions).toEqual([
      {
        tool: 'search',
        servers: ['@modelcontextprotocol/server-github', 'search-mcp'],
        writes: false,
      },
    ]);
    expect(config.totalTools).toBeNull();
    // The .vscode/mcp.json read failed, and is counted rather than looking like no config.
    expect(mcp.unreadFiles).toBe(1);
  });

  it('calls a repo an MCP server only on evidence, and says when it is not probed yet', async () => {
    const manifest = {
      name: '@ada/weather-mcp',
      bin: { weather: 'dist/index.js' },
      dependencies: { '@modelcontextprotocol/sdk': '^1.0.0' },
    };
    const mcp = await profileMcp(
      'ada',
      [
        { name: 'weather', manifest },
        { name: 'site', manifest: { name: 'site' } },
      ],
      deps(),
    );
    expect(mcp.builds).toEqual([
      expect.objectContaining({
        repo: 'ada/weather',
        packageName: '@ada/weather-mcp',
        status: 'queued',
      }),
    ]);
    expect(mcp.configs).toEqual([]);
  });
});

describe('tool detail', () => {
  it('carries at most TOOLS_SHOWN tools, leaving the counts exact', async () => {
    const many = Array.from({ length: TOOLS_SHOWN + 5 }, (_, i) =>
      tool(`t${String(i).padStart(2, '0')}`, true),
    );
    const mcp = await profileMcp('ada', [{ name: 'app', manifest: null }], {
      read: async (_repo: string, path: string) =>
        path === '.mcp.json'
          ? ok({ mcpServers: { big: { command: 'npx', args: ['-y', 'big-mcp'] } } })
          : missing,
      surface: async () => surface({ tools: many }),
    });
    const server = mcp.configs[0]!.servers[0]!;
    expect(server.tools).toBe(many.length);
    expect(server.toolDetail).toHaveLength(TOOLS_SHOWN);
  });
});
