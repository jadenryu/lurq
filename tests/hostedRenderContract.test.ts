/**
 * Hosted CLI renderers against what the server actually sends.
 *
 * Every hosted tool result passes through `compact()` before it reaches the CLI.
 * `compact` used to drop empty arrays, so a clean package's `verdict.reasons: []`
 * never arrived and `lurq verify` threw "v.reasons is not iterable" for every
 * hosted user; `mcp-drift` and `mcp-surface` crashed the same way. These run a
 * real handler result through the real `compact` into the real renderer, and
 * again through the old stripping rule, because servers and clients from before
 * the fix are still deployed and each side must survive the other.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let serverResult: unknown;
vi.mock('../src/cli/remote', () => ({
  MissingKeyError: class extends Error {},
  // What callTool hands back: the handler result after a JSON round trip.
  callTool: vi.fn(async () => JSON.parse(JSON.stringify(serverResult))),
}));
vi.mock('../src/ingestion/sources', () => ({
  npmPackageExists: vi.fn(),
  fetchNpmRegistry: vi.fn(),
  fetchWeeklyDownloads: vi.fn(),
  fetchNpmCompatAtVersion: vi.fn(),
  npmVersionExists: vi.fn(),
}));
vi.mock('../src/pipeline/single', () => ({
  getOrFetchPackage: vi.fn(),
  FIRST_TOUCH_BUDGET_MS: 4000,
}));
vi.mock('../src/db/packages', () => ({
  getTopPackageNames: vi.fn(),
  getPackageByName: vi.fn(),
  getPackageVersions: vi.fn(),
}));

import { runMcpDrift, runMcpSurface, runVerify } from '../src/cli/commands';
import { compact } from '../src/mcp/compact';
import { handleVerify } from '../src/mcp/handlers';
import { summarize } from '../src/mcp/mcpHandlers';
import * as packages from '../src/db/packages';
import * as sources from '../src/ingestion/sources';
import * as single from '../src/pipeline/single';
import { diffMcpSurfaces, mcpSurface, type McpTool } from '../src/surface/mcp';

/** The pre-fix compaction rule: nulls AND empty containers dropped. */
function legacyCompact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(legacyCompact);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const c = v === null ? null : legacyCompact(v);
      if (c === null || c === undefined) continue;
      if (Array.isArray(c) && c.length === 0) continue;
      if (typeof c === 'object' && !Array.isArray(c) && Object.keys(c).length === 0) continue;
      out[k] = c;
    }
    return out;
  }
  return value;
}

const servers = [
  ['current server', compact],
  ['pre-fix server', legacyCompact],
] as const;

const db = {} as never;
let printed: string;

beforeEach(() => {
  process.env.LURQ_API_KEY = 'lurq_live_test';
  vi.mocked(packages.getTopPackageNames).mockResolvedValue([]);
  printed = '';
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    printed += a.join(' ') + '\n';
  });
});
afterEach(() => {
  delete process.env.LURQ_API_KEY;
  vi.restoreAllMocks();
});

describe.each(servers)('lurq verify against a %s', (_label, pack) => {
  it('renders a clean package (empty reasons and unknowns)', async () => {
    vi.mocked(sources.npmPackageExists).mockResolvedValue(true);
    vi.mocked(sources.fetchNpmRegistry).mockResolvedValue({
      latestVersion: '4.0.0',
      deprecated: false,
      firstPublishedAt: new Date('2020-01-01'),
      maintainersCount: 3,
      hasInstallScripts: false,
    } as never);
    vi.mocked(single.getOrFetchPackage).mockResolvedValue({
      row: {
        name: 'zod',
        weeklyDownloads: 5_000_000,
        advisories: [],
        deprecated: false,
        archived: false,
        confidence: 'proven',
        latestVersion: '4.0.0',
      },
      wasTracked: true,
      existsOnNpm: true,
    } as never);
    const result = await handleVerify(db, { package: 'zod' });
    expect(result.verdict.reasons).toEqual([]);
    serverResult = pack(result);

    await runVerify('zod', {});
    expect(printed).toContain('no supply-chain problems found');
    expect(printed).toContain('advisories');
  });

  it('renders a package that does not exist (empty unknowns)', async () => {
    vi.mocked(sources.npmPackageExists).mockResolvedValue(false);
    serverResult = pack(await handleVerify(db, { package: 'lodahs-nope' }));

    await runVerify('lodahs-nope', {});
    expect(printed).toContain('NOT A REAL PACKAGE');
  });

  it('says "not checked yet" for never-checked advisories, never "undefined"', async () => {
    vi.mocked(sources.npmPackageExists).mockResolvedValue(true);
    vi.mocked(sources.fetchNpmRegistry).mockResolvedValue(null as never);
    vi.mocked(sources.fetchWeeklyDownloads).mockResolvedValue(50_000);
    vi.mocked(single.getOrFetchPackage).mockResolvedValue({
      row: null,
      wasTracked: false,
      existsOnNpm: true,
    } as never);
    serverResult = pack(await handleVerify(db, { package: 'fresh-pkg' }));

    await runVerify('fresh-pkg', {});
    expect(printed).toContain('not checked yet');
    expect(printed).not.toContain('undefined');
  });
});

describe.each(servers)('lurq mcp-drift / mcp-surface against a %s', (_label, pack) => {
  const tool: McpTool = {
    name: 'search',
    description: 'search things',
    inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
  };

  it('renders an upgrade that changed nothing (every list empty)', async () => {
    const drift = diffMcpSurfaces(
      mcpSurface('srv', '1.0.0', [tool]),
      mcpSurface('srv', '1.1.0', [tool]),
    );
    serverResult = pack({
      ...drift,
      verdict: 'verified_true',
      class: 'derived',
      summary: summarize(drift),
      observedAt: null,
    });

    await runMcpDrift('srv', { from: '1.0.0', to: '1.1.0' });
    expect(printed).toContain('srv');
  });

  it('renders a server that has not been probed (no tools)', async () => {
    serverResult = pack({
      server: 'srv',
      version: null,
      verdict: 'unknown',
      class: null,
      tier: null,
      tools: [],
      requires: [],
      configRequest: null,
      coverageNote: 'not probed yet; queued',
      observedAt: null,
    });

    await runMcpSurface('srv', {});
    expect(printed).toContain('not probed yet');
  });
});
