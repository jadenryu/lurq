/**
 * Local discovery: what does this project actually depend on?
 *
 * Runs entirely on the user's machine and reads only manifests and agent
 * configs. No source file is opened and nothing but names and versions ever
 * leaves — the same rule `check-upgrade` holds, and the reason an audit can be
 * run against the hosted index without anyone having to think about it.
 *
 * Two inventories, because a project's dependencies live in two unrelated
 * places. npm packages are declared in `package.json` and resolved in a
 * lockfile. MCP servers are declared in agent configs that are not in the
 * repository at all — `~/.claude.json`, `~/.cursor/mcp.json`, a project
 * `.mcp.json` — which is why a repo scan alone can never see them.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { Inventory, InventoryMcpServer, InventoryPackage, ItemSource, McpKind } from './types';

/** Dependency sections worth auditing. `peerDependencies` is the host's problem. */
const DEP_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;

/**
 * Ceiling on discovered items.
 *
 * A monorepo can declare thousands of dependencies, and an audit that takes a
 * minute is an audit nobody runs twice. Anything past the cap is reported as
 * `truncated` rather than dropped — see the coverage rule in `./types`.
 */
export const MAX_ITEMS = 600;

function readJson(path: string): unknown | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Split an npm spec into name and version.
 *
 * The leading `@` of a scope is not a separator, so the split is on the last
 * `@` that is not at index 0. `pkg@latest` and `pkg@next` carry a dist-tag
 * rather than a version, and a tag is not something that can be diffed — they
 * come back as unpinned, which is the truth about them.
 */
export function splitSpec(spec: string): { name: string; version: string | null } {
  const at = spec.lastIndexOf('@');
  if (at <= 0) return { name: spec, version: null };
  const name = spec.slice(0, at);
  const version = spec.slice(at + 1);
  if (!/^\d/.test(version)) return { name, version: null }; // dist-tag, not a version
  return { name, version };
}

/** Package-manager runners that fetch from npm, and the flags to step over. */
const NPM_RUNNERS = new Set(['npx', 'bunx', 'pnpx']);
const RUNNER_FLAGS = new Set(['-y', '--yes', '--no-install', '--silent', '-q', '--quiet', '-p']);
/** Runners for registries lurq does not index. */
const OTHER_RUNNERS = new Set(['uvx', 'pipx', 'uv', 'pip', 'python', 'python3', 'go', 'cargo']);

interface RawServer {
  command?: unknown;
  args?: unknown;
  url?: unknown;
  type?: unknown;
}

/**
 * Classify one MCP server entry.
 *
 * The important output is honesty about what lurq can and cannot read. A remote
 * endpoint has no package to install; a `uvx` server is PyPI; a bare path is
 * someone's local build. Reporting any of those as "not in the index" would be
 * misleading — they are out of scope for a different reason in each case, and
 * the reason is what a reader needs.
 */
export function classifyServer(alias: string, raw: RawServer): Omit<InventoryMcpServer, 'sources'> {
  const base = { alias, packageName: null, version: null, endpoint: null };

  if (typeof raw.url === 'string' && raw.url) {
    let endpoint = raw.url;
    try {
      endpoint = new URL(raw.url).host;
    } catch {
      /* keep the raw string; a malformed url is still worth showing */
    }
    return { ...base, kind: 'remote' as McpKind, endpoint };
  }

  const command = typeof raw.command === 'string' ? raw.command : '';
  const args = Array.isArray(raw.args)
    ? raw.args.filter((a): a is string => typeof a === 'string')
    : [];
  const bin = command.split(/[\\/]/).pop() ?? '';

  if (OTHER_RUNNERS.has(bin)) return { ...base, kind: 'other-registry' as McpKind };

  if (NPM_RUNNERS.has(bin) || (bin === 'pnpm' && args[0] === 'dlx')) {
    // First argument that is neither a flag nor a flag's value is the spec.
    const rest = bin === 'pnpm' ? args.slice(1) : args;
    const spec = rest.find((a) => !a.startsWith('-') && !RUNNER_FLAGS.has(a));
    if (!spec) return { ...base, kind: 'npm-stdio' as McpKind };
    const { name, version } = splitSpec(spec);
    return { ...base, kind: 'npm-stdio' as McpKind, packageName: name, version };
  }

  // `node ./dist/server.js` and friends: a real server, but not one that can be
  // resolved from a registry, so no version and nothing to diff against.
  return { ...base, kind: 'local' as McpKind };
}

/** Every MCP server declared in one config object, whatever the dialect. */
export function serversFromConfig(config: unknown, file: string): InventoryMcpServer[] {
  if (!config || typeof config !== 'object') return [];
  const out: InventoryMcpServer[] = [];
  // `mcpServers` is the Claude/Cursor/Windsurf spelling, `servers` is VS Code's.
  for (const section of ['mcpServers', 'servers']) {
    const block = (config as Record<string, unknown>)[section];
    if (!block || typeof block !== 'object') continue;
    for (const [alias, raw] of Object.entries(block as Record<string, unknown>)) {
      if (!raw || typeof raw !== 'object') continue;
      out.push({
        ...classifyServer(alias, raw as RawServer),
        sources: [{ file, section }],
      });
    }
  }
  return out;
}

/** Config files that may declare MCP servers, project-local first. */
export function mcpConfigPaths(root: string, home = homedir()): string[] {
  return [
    join(root, '.mcp.json'),
    join(root, '.cursor', 'mcp.json'),
    join(root, '.vscode', 'mcp.json'),
    join(root, '.windsurf', 'mcp.json'),
    join(home, '.claude.json'),
    join(home, '.cursor', 'mcp.json'),
    join(home, '.codeium', 'windsurf', 'mcp_config.json'),
    join(home, '.gemini', 'settings.json'),
  ];
}

/**
 * Resolved version for an installed package.
 *
 * `node_modules` is read before the lockfile because it is the ground truth for
 * what will actually load, and because it is one cheap stat per package against
 * parsing a multi-megabyte lockfile. The lockfile is the fallback for a project
 * that has not installed yet.
 */
function installedFrom(root: string, name: string, lock: Map<string, string>): string | null {
  const pkgJson = join(root, 'node_modules', ...name.split('/'), 'package.json');
  if (existsSync(pkgJson)) {
    const m = readJson(pkgJson) as { version?: unknown } | null;
    if (m && typeof m.version === 'string') return m.version;
  }
  return lock.get(name) ?? null;
}

/** `name -> version` from an npm v2/v3 lockfile. Empty map when there is none. */
export function readLockfile(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const lock = readJson(join(root, 'package-lock.json')) as {
    packages?: Record<string, { version?: unknown }>;
    dependencies?: Record<string, { version?: unknown }>;
  } | null;
  if (!lock) return out;
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    // Keys look like `node_modules/foo` or `node_modules/a/node_modules/b`;
    // the last segment after the final `node_modules/` is the package name.
    const idx = path.lastIndexOf('node_modules/');
    if (idx < 0) continue;
    const name = path.slice(idx + 'node_modules/'.length);
    if (name && typeof entry?.version === 'string' && !out.has(name)) out.set(name, entry.version);
  }
  for (const [name, entry] of Object.entries(lock.dependencies ?? {})) {
    if (typeof entry?.version === 'string' && !out.has(name)) out.set(name, entry.version);
  }
  return out;
}

/** Workspace package.json paths, one level deep under each declared glob root. */
function workspaceManifests(root: string, patterns: string[]): string[] {
  const out: string[] = [];
  for (const pattern of patterns) {
    // Only the common `dir/*` and `dir` shapes. A full glob engine is not worth
    // a dependency for a path that already degrades gracefully: an unmatched
    // workspace is simply not audited, and the file list says what was read.
    const base = pattern.replace(/\/\*+$/, '');
    const dir = resolve(root, base);
    if (!existsSync(dir)) continue;
    const entries = pattern.endsWith('*') ? readdirSync(dir).map((d) => join(dir, d)) : [dir];
    for (const e of entries) {
      try {
        if (!statSync(e).isDirectory()) continue;
      } catch {
        continue;
      }
      const m = join(e, 'package.json');
      if (existsSync(m)) out.push(m);
    }
  }
  return out;
}

export interface InventoryOptions {
  /** Override the home directory, for tests. */
  home?: string;
  /** Skip user-level agent configs — project files only. */
  projectOnly?: boolean;
  maxItems?: number;
}

/**
 * Read a directory into an inventory.
 *
 * Never throws for a malformed or unreadable file: discovery problems are
 * appended to `notes`, because an audit that dies on one bad config tells the
 * user nothing about the forty things that were fine.
 */
export function collectInventory(root: string, opts: InventoryOptions = {}): Inventory {
  const abs = resolve(root);
  const max = opts.maxItems ?? MAX_ITEMS;
  const filesRead: string[] = [];
  const notes: string[] = [];
  const rel = (p: string) => (isAbsolute(p) && p.startsWith(abs) ? relative(abs, p) || '.' : p);

  // ---- npm packages -------------------------------------------------------
  const byName = new Map<string, InventoryPackage>();
  const rootManifest = join(abs, 'package.json');
  const manifests: string[] = [];
  if (existsSync(rootManifest)) {
    manifests.push(rootManifest);
    const m = readJson(rootManifest) as { workspaces?: unknown } | null;
    const ws = Array.isArray(m?.workspaces)
      ? m.workspaces
      : Array.isArray((m?.workspaces as { packages?: unknown } | undefined)?.packages)
        ? ((m!.workspaces as { packages: unknown[] }).packages as unknown[])
        : [];
    manifests.push(
      ...workspaceManifests(
        abs,
        ws.filter((p): p is string => typeof p === 'string'),
      ),
    );
  } else {
    notes.push(`no package.json at ${abs}; npm half of the audit is empty`);
  }

  const lock = readLockfile(abs);
  for (const path of manifests) {
    const m = readJson(path) as Record<string, unknown> | null;
    if (!m) {
      notes.push(`could not parse ${rel(path)}`);
      continue;
    }
    filesRead.push(rel(path));
    for (const section of DEP_SECTIONS) {
      const block = m[section];
      if (!block || typeof block !== 'object') continue;
      for (const [name, range] of Object.entries(block as Record<string, unknown>)) {
        if (typeof range !== 'string') continue;
        const src: ItemSource = { file: rel(path), section };
        const seen = byName.get(name);
        if (seen) {
          seen.sources.push(src);
          continue;
        }
        byName.set(name, {
          name,
          range,
          installed: installedFrom(abs, name, lock),
          sources: [src],
        });
      }
    }
  }

  // ---- MCP servers --------------------------------------------------------
  const byAlias = new Map<string, InventoryMcpServer>();
  for (const path of mcpConfigPaths(abs, opts.home)) {
    if (opts.projectOnly && !path.startsWith(abs)) continue;
    if (!existsSync(path)) continue;
    const cfg = readJson(path);
    if (!cfg) {
      notes.push(`could not parse ${rel(path)}`);
      continue;
    }
    const found = serversFromConfig(cfg, rel(path));
    if (found.length) filesRead.push(rel(path));
    for (const s of found) {
      // Key on the package (or endpoint) rather than the alias: the same server
      // configured in three agents is one thing to check, not three, and
      // reporting it three times is how a report earns being ignored.
      const key = s.packageName ?? s.endpoint ?? `${s.kind}:${s.alias}`;
      const seen = byAlias.get(key);
      if (seen) {
        seen.sources.push(...s.sources);
        seen.version ??= s.version;
        continue;
      }
      byAlias.set(key, s);
    }
  }

  const packages = [...byName.values()];
  const mcpServers = [...byAlias.values()];
  const total = packages.length + mcpServers.length;
  if (total > max) {
    notes.push(
      `${total} items discovered, auditing the first ${max}; the remainder are reported as truncated rather than dropped`,
    );
  }

  return {
    root: abs,
    packages: packages.slice(0, max),
    mcpServers: mcpServers.slice(0, Math.max(0, max - packages.length)),
    filesRead,
    notes,
  };
}
