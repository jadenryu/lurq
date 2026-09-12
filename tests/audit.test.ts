/**
 * Project audit: local discovery and honest coverage accounting.
 *
 * The rule every case here defends is the same one: an item lurq could not
 * assess must be reported as unassessed, with a reason. A dependency that was
 * never looked at, a vulnerability lookup that failed, an MCP server that
 * floats unpinned — each of those is silence, and silence rendered as "nothing
 * flagged" is the one way this feature could actively mislead someone.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  classifyServer,
  collectInventory,
  readLockfile,
  readLockTree,
  attributeTree,
  serversFromConfig,
  splitSpec,
} from '../src/audit/inventory';
import { worstSeverity, type Finding } from '../src/audit/types';

const dirs: string[] = [];
function fixture(files: Record<string, unknown | string>): string {
  const root = mkdtempSync(join(tmpdir(), 'lurq-audit-'));
  dirs.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, typeof body === 'string' ? body : JSON.stringify(body));
  }
  return root;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('splitSpec', () => {
  it('does not mistake a scope for a version separator', () => {
    expect(splitSpec('@scope/pkg@1.2.3')).toEqual({ name: '@scope/pkg', version: '1.2.3' });
    expect(splitSpec('@scope/pkg')).toEqual({ name: '@scope/pkg', version: null });
    expect(splitSpec('pkg@1.0.0')).toEqual({ name: 'pkg', version: '1.0.0' });
  });

  // A dist-tag is not a version: `pkg@latest` resolves to something different
  // tomorrow, so treating it as pinned would let the report claim a comparison
  // it cannot make.
  it('treats a dist-tag as unpinned', () => {
    expect(splitSpec('pkg@latest').version).toBeNull();
    expect(splitSpec('pkg@next').version).toBeNull();
  });
});

describe('classifyServer', () => {
  it('reads an npm stdio server through npx, flags and all', () => {
    const s = classifyServer('gh', {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
    });
    expect(s.kind).toBe('npm-stdio');
    expect(s.packageName).toBe('@modelcontextprotocol/server-github');
    expect(s.version).toBeNull();
  });

  it('keeps a pinned version when the config names one', () => {
    const s = classifyServer('gh', { command: 'npx', args: ['-y', 'some-mcp@2.1.0'] });
    expect(s.version).toBe('2.1.0');
  });

  it('handles pnpm dlx and bunx', () => {
    expect(classifyServer('a', { command: 'pnpm', args: ['dlx', 'x-mcp'] }).packageName).toBe(
      'x-mcp',
    );
    expect(classifyServer('b', { command: 'bunx', args: ['-y', 'y-mcp'] }).packageName).toBe(
      'y-mcp',
    );
  });

  /**
   * Each of these is out of scope for a DIFFERENT reason, and the reason is the
   * useful part. Collapsing them all into "unknown" would tell a user their
   * hosted server is unindexed when the truth is that there is no artifact to
   * index at all.
   */
  it('separates remote, other-registry and local servers', () => {
    expect(classifyServer('r', { type: 'http', url: 'https://mcp.example.com/v1' })).toMatchObject({
      kind: 'remote',
      endpoint: 'mcp.example.com',
    });
    expect(classifyServer('p', { command: 'uvx', args: ['some-py-mcp'] }).kind).toBe(
      'other-registry',
    );
    expect(classifyServer('l', { command: 'node', args: ['./dist/server.js'] }).kind).toBe('local');
  });
});

describe('serversFromConfig', () => {
  it('reads both the mcpServers and servers dialects', () => {
    expect(
      serversFromConfig({ mcpServers: { a: { command: 'npx', args: ['a-mcp'] } } }, 'f').map(
        (s) => s.alias,
      ),
    ).toEqual(['a']);
    expect(
      serversFromConfig({ servers: { b: { command: 'npx', args: ['b-mcp'] } } }, 'f').map(
        (s) => s.alias,
      ),
    ).toEqual(['b']);
  });

  it('ignores malformed entries instead of throwing', () => {
    expect(serversFromConfig({ mcpServers: { a: 'not-an-object' } }, 'f')).toEqual([]);
    expect(serversFromConfig(null, 'f')).toEqual([]);
  });
});

describe('readLockfile', () => {
  it('reads resolved versions out of a v3 lockfile', () => {
    const root = fixture({
      'package-lock.json': {
        packages: {
          '': { name: 'x' },
          'node_modules/zod': { version: '3.25.76' },
          'node_modules/a/node_modules/nested': { version: '1.0.0' },
        },
      },
    });
    const lock = readLockfile(root);
    expect(lock.get('zod')).toBe('3.25.76');
    expect(lock.get('nested')).toBe('1.0.0');
  });

  it('is empty rather than throwing when there is no lockfile', () => {
    expect(readLockfile(fixture({}))).toEqual(new Map());
  });
});

describe('collectInventory', () => {
  it('reads declared deps and the versions actually installed', () => {
    const root = fixture({
      'package.json': { dependencies: { zod: '^3.0.0' }, devDependencies: { vitest: '^2.0.0' } },
      'package-lock.json': { packages: { 'node_modules/zod': { version: '3.25.76' } } },
      'node_modules/vitest/package.json': { version: '2.1.9' },
    });
    const inv = collectInventory(root, { projectOnly: true });
    const byName = new Map(inv.packages.map((p) => [p.name, p]));
    // node_modules is ground truth for what will load; the lockfile is fallback.
    expect(byName.get('vitest')?.installed).toBe('2.1.9');
    expect(byName.get('zod')?.installed).toBe('3.25.76');
  });

  it('leaves installed null when nothing has been installed', () => {
    const root = fixture({ 'package.json': { dependencies: { zod: '^3.0.0' } } });
    expect(collectInventory(root, { projectOnly: true }).packages[0]?.installed).toBeNull();
  });

  it('picks up workspace manifests', () => {
    const root = fixture({
      'package.json': { workspaces: ['apps/*'], dependencies: { root: '^1.0.0' } },
      'apps/web/package.json': { dependencies: { react: '^19.0.0' } },
    });
    const names = collectInventory(root, { projectOnly: true }).packages.map((p) => p.name);
    expect(names).toContain('root');
    expect(names).toContain('react');
  });

  it('records a dependency declared in two manifests once, with both sources', () => {
    const root = fixture({
      'package.json': { workspaces: ['apps/*'], dependencies: { zod: '^3.0.0' } },
      'apps/web/package.json': { dependencies: { zod: '^3.1.0' } },
    });
    const zod = collectInventory(root, { projectOnly: true }).packages.filter(
      (p) => p.name === 'zod',
    );
    expect(zod).toHaveLength(1);
    expect(zod[0]!.sources).toHaveLength(2);
  });

  it('reads project MCP config and dedupes a server configured twice', () => {
    const root = fixture({
      'package.json': { dependencies: {} },
      '.mcp.json': { mcpServers: { gh: { command: 'npx', args: ['-y', 'gh-mcp'] } } },
      '.cursor/mcp.json': { mcpServers: { github: { command: 'npx', args: ['-y', 'gh-mcp'] } } },
    });
    const inv = collectInventory(root, { projectOnly: true });
    // The same package wired into two agents is one thing to check, not two.
    expect(inv.mcpServers.filter((s) => s.packageName === 'gh-mcp')).toHaveLength(1);
  });

  // An audit that dies on one bad file tells the user nothing about the forty
  // things that were fine.
  it('notes a malformed config instead of throwing', () => {
    const root = fixture({ 'package.json': { dependencies: {} }, '.mcp.json': '{ broken' });
    const inv = collectInventory(root, { projectOnly: true });
    expect(inv.notes.join(' ')).toMatch(/could not parse/);
  });

  it('reports truncation rather than silently dropping items', () => {
    const deps: Record<string, string> = {};
    for (let i = 0; i < 20; i++) deps[`pkg-${i}`] = '^1.0.0';
    const root = fixture({ 'package.json': { dependencies: deps } });
    const inv = collectInventory(root, { projectOnly: true, maxItems: 5 });
    expect(inv.packages).toHaveLength(5);
    expect(inv.notes.join(' ')).toMatch(/truncated/);
  });

  it('honours projectOnly so a test never reads the real home directory', () => {
    const root = fixture({ 'package.json': { dependencies: {} } });
    expect(collectInventory(root, { projectOnly: true }).mcpServers).toEqual([]);
  });
});

describe('worstSeverity', () => {
  const f = (severity: Finding['severity']): Finding => ({
    kind: 'outdated',
    severity,
    detail: '',
  });

  it('surfaces the finding that can hurt you most', () => {
    expect(worstSeverity([f('info'), f('high'), f('low')])).toBe('high');
    expect(worstSeverity([])).toBeNull();
  });
});

/**
 * The single most dangerous thing this feature could do is print "nothing
 * flagged" over a vulnerability lookup that never landed. OSV returning no
 * results and OSV never answering are indistinguishable from the shape of the
 * response, so completeness has to travel separately and reach the report.
 */
describe('a failed vulnerability lookup is never an all-clear', () => {
  // Minimal stand-in for the indexed read: drizzle's builder is thenable, so a
  // `where` that resolves to rows is all `loadIndexed` needs.
  const fakeDb = {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
  } as unknown as import('../src/db/client').Database;

  const inv = {
    root: '/x',
    packages: [{ name: 'zod', range: '^3.0.0', installed: '3.25.76', sources: [] }],
    mcpServers: [],
    transitives: [],
    filesRead: [],
    notes: [],
  };

  it('marks the report incomplete when the lookup throws', async () => {
    const { assessInventory } = await import('../src/audit/assess');
    const report = await assessInventory(fakeDb, inv, {
      vulnLookup: async () => {
        throw new Error('network down');
      },
    });
    expect(report.coverage.vulnComplete).toBe(false);
    expect(report.notes.join(' ')).toMatch(/PARTIAL/);
  });

  it('marks it incomplete when OSV answers only some batches', async () => {
    const { assessInventory } = await import('../src/audit/assess');
    const report = await assessInventory(fakeDb, inv, {
      vulnLookup: async () => ({ affected: new Map(), complete: false }),
    });
    expect(report.coverage.vulnComplete).toBe(false);
  });

  it('says complete only when the lookup actually completed', async () => {
    const { assessInventory } = await import('../src/audit/assess');
    const report = await assessInventory(fakeDb, inv, {
      vulnLookup: async () => ({ affected: new Map(), complete: true }),
    });
    expect(report.coverage.vulnComplete).toBe(true);
    expect(report.notes.join(' ')).not.toMatch(/PARTIAL/);
  });

  // A package the index has never seen is not a clean package.
  it('reports an unindexed dependency as queued, never as answered', async () => {
    const { assessInventory } = await import('../src/audit/assess');
    const report = await assessInventory(fakeDb, inv, {
      vulnLookup: async () => ({ affected: new Map(), complete: true }),
    });
    expect(report.items[0]).toMatchObject({ status: 'queued', skipReason: 'not-in-index' });
    expect(report.coverage.answered).toBe(0);
    expect(report.coverage.queued).toBe(1);
  });
});

describe('resolved tree', () => {
  it('reads every install and the edges between them', () => {
    const root = fixture({
      'package-lock.json': {
        packages: {
          '': { name: 'x' },
          'node_modules/eslint': { version: '9.0.0', dependencies: { minimatch: '^3.0.0' } },
          'node_modules/minimatch': {
            version: '3.0.4',
            dependencies: { 'brace-expansion': '^1.0.0' },
          },
          'node_modules/brace-expansion': { version: '1.1.11' },
        },
      },
    });
    const { installs, edges, present } = readLockTree(root);
    expect(present).toBe(true);
    expect(installs.get('brace-expansion')).toBe('1.1.11');
    expect([...(edges.get('eslint') ?? [])]).toEqual(['minimatch']);
  });

  it('reports absence rather than an empty tree when there is no lockfile', () => {
    expect(readLockTree(fixture({})).present).toBe(false);
  });

  /**
   * The actionable half. "brace-expansion 1.1.11 is vulnerable" is not something
   * a user can do anything about — they never installed it. "via eslint" is.
   */
  it('attributes a deep transitive back to the direct dependency', () => {
    const edges = new Map([
      ['eslint', new Set(['minimatch'])],
      ['minimatch', new Set(['brace-expansion'])],
    ]);
    const via = attributeTree(['eslint'], edges);
    expect(via.get('brace-expansion')).toEqual(['eslint']);
  });

  it('credits every direct dependency that reaches the same package', () => {
    const edges = new Map([
      ['eslint', new Set(['minimatch'])],
      ['vitest', new Set(['minimatch'])],
    ]);
    expect(attributeTree(['eslint', 'vitest'], edges).get('minimatch')).toEqual([
      'eslint',
      'vitest',
    ]);
  });

  it('terminates on a dependency cycle', () => {
    const edges = new Map([
      ['a', new Set(['b'])],
      ['b', new Set(['a', 'c'])],
    ]);
    const via = attributeTree(['a'], edges);
    expect(via.get('c')).toEqual(['a']);
  });

  it('separates direct dependencies from the tree below them', () => {
    const root = fixture({
      'package.json': { dependencies: { eslint: '^9.0.0' } },
      'package-lock.json': {
        packages: {
          'node_modules/eslint': { version: '9.0.0', dependencies: { minimatch: '^3.0.0' } },
          'node_modules/minimatch': { version: '3.0.4' },
        },
      },
    });
    const inv = collectInventory(root, { projectOnly: true });
    expect(inv.packages.map((p) => p.name)).toEqual(['eslint']);
    expect(inv.transitives).toEqual([{ name: 'minimatch', version: '3.0.4', via: ['eslint'] }]);
  });

  // A project with no lockfile has an UNCHECKED tree, not an empty one, and the
  // report has to say so or a clean result overstates what was verified.
  it('warns loudly when there is no lockfile to read the tree from', () => {
    const root = fixture({ 'package.json': { dependencies: { eslint: '^9.0.0' } } });
    const inv = collectInventory(root, { projectOnly: true });
    expect(inv.transitives).toEqual([]);
    expect(inv.notes.join(' ')).toMatch(/transitive vulnerabilities are NOT covered/);
  });
});

/**
 * OSV is keyed on name and version alone and needs nothing from lurq's
 * catalogue, so a package we have never indexed can still be known-vulnerable.
 * Gating the check on an index hit suppressed the most dangerous finding this
 * feature produces behind an entirely unrelated coverage gap: a fresh install
 * of a known-vulnerable package reported "nothing flagged".
 */
describe('vulnerabilities do not depend on lurq having indexed the package', () => {
  const emptyIndexDb = {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
  } as unknown as import('../src/db/client').Database;

  it('reports a CVE for a package the index has never seen', async () => {
    const { assessInventory } = await import('../src/audit/assess');
    const report = await assessInventory(
      emptyIndexDb,
      {
        root: '/x',
        packages: [{ name: 'tough-cookie', range: '4.0.0', installed: '4.0.0', sources: [] }],
        mcpServers: [],
        transitives: [],
        filesRead: [],
        notes: [],
      },
      {
        vulnLookup: async () => ({
          affected: new Map([['tough-cookie@4.0.0', ['GHSA-72xf-g2v4-qvf3']]]),
          complete: true,
        }),
      },
    );
    const item = report.items[0]!;
    expect(item.findings.some((f) => f.kind === 'vulnerable')).toBe(true);
    // Still queued — the drift question genuinely is unanswerable without the
    // index — but "queued" must never swallow a finding we already have.
    expect(item.status).toBe('queued');
  });

  it('surfaces a vulnerable transitive with the direct dependency that pulls it in', async () => {
    const { assessInventory } = await import('../src/audit/assess');
    const report = await assessInventory(
      emptyIndexDb,
      {
        root: '/x',
        packages: [],
        mcpServers: [],
        transitives: [{ name: 'flatted', version: '2.0.2', via: ['eslint'] }],
        filesRead: [],
        notes: [],
      },
      {
        vulnLookup: async () => ({
          affected: new Map([['flatted@2.0.2', ['GHSA-25h7-pfq9-p65f']]]),
          complete: true,
        }),
      },
    );
    const item = report.items.find((i) => i.unit === 'transitive')!;
    expect(item.via).toEqual(['eslint']);
    expect(item.findings[0]!.detail).toMatch(/via eslint/);
  });

  it('does not list a healthy transitive at all', async () => {
    const { assessInventory } = await import('../src/audit/assess');
    const report = await assessInventory(
      emptyIndexDb,
      {
        root: '/x',
        packages: [],
        mcpServers: [],
        transitives: [{ name: 'safe-pkg', version: '1.0.0', via: ['eslint'] }],
        filesRead: [],
        notes: [],
      },
      { vulnLookup: async () => ({ affected: new Map(), complete: true }) },
    );
    expect(report.items).toEqual([]);
    // Checked, though — the count is what makes a clean report mean something.
    expect(report.coverage.transitivesChecked).toBe(1);
  });
});

describe('workspace discovery', () => {
  it('expands an exact path, a shallow glob and a deep glob', () => {
    const root = fixture({
      'package.json': { workspaces: ['tools', 'apps/*', 'packages/**'] },
      'tools/package.json': { dependencies: { a: '^1.0.0' } },
      'apps/web/package.json': { dependencies: { b: '^1.0.0' } },
      'packages/group/inner/package.json': { dependencies: { c: '^1.0.0' } },
    });
    const names = collectInventory(root, { projectOnly: true }).packages.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['a', 'b', 'c']));
  });

  /**
   * pnpm keeps its workspaces in a YAML file, so an npm-shaped reader saw zero
   * of them — and a workspace that matches nothing is indistinguishable from a
   * project that has none, which is how a whole monorepo goes unaudited in
   * silence.
   */
  it('reads pnpm-workspace.yaml, not just package.json', () => {
    const root = fixture({
      'package.json': { dependencies: {} },
      'pnpm-workspace.yaml': 'packages:\n  - "libs/*"\n',
      'libs/one/package.json': { dependencies: { 'pnpm-only-dep': '^1.0.0' } },
    });
    const names = collectInventory(root, { projectOnly: true }).packages.map((p) => p.name);
    expect(names).toContain('pnpm-only-dep');
  });

  it('honours ! exclusions', () => {
    const root = fixture({
      'package.json': { workspaces: ['pkgs/*', '!pkgs/fixtures'] },
      'pkgs/real/package.json': { dependencies: { kept: '^1.0.0' } },
      'pkgs/fixtures/package.json': { dependencies: { excluded: '^1.0.0' } },
    });
    const names = collectInventory(root, { projectOnly: true }).packages.map((p) => p.name);
    expect(names).toContain('kept');
    expect(names).not.toContain('excluded');
  });

  // A deep glob must not walk into dependency trees or build output, or
  // discovery turns into a filesystem crawl of every installed package.
  it('does not descend into node_modules or build output', () => {
    const root = fixture({
      'package.json': { workspaces: ['pkgs/**'] },
      'pkgs/a/package.json': { dependencies: { kept: '^1.0.0' } },
      'pkgs/a/node_modules/evil/package.json': { dependencies: { nope: '^1.0.0' } },
      'pkgs/a/dist/package.json': { dependencies: { alsonope: '^1.0.0' } },
    });
    const names = collectInventory(root, { projectOnly: true }).packages.map((p) => p.name);
    expect(names).toContain('kept');
    expect(names).not.toContain('nope');
    expect(names).not.toContain('alsonope');
  });

  it('survives a malformed pnpm-workspace.yaml', () => {
    const root = fixture({
      'package.json': { dependencies: { root: '^1.0.0' } },
      'pnpm-workspace.yaml': 'packages: [ unclosed',
    });
    expect(collectInventory(root, { projectOnly: true }).packages.map((p) => p.name)).toEqual([
      'root',
    ]);
  });
});
