/**
 * Read every MCP server a user has configured, with enough detail to launch it.
 *
 * `audit/inventory` answers "which servers are there" and deliberately keeps
 * names only. A live scan needs the rest — command, args, env, url, headers —
 * because the whole premise is that the user's own configuration is the one
 * that works: the right credentials, the right flags, the right toolsets. A
 * blank-config sandbox probe can disagree with what the user's agent actually
 * sees; this cannot.
 *
 * Three outputs matter beyond the launch spec:
 *
 *   - IDENTITY (`serverKey`). Stable across machines and versions, so a daily
 *     scan appends to one history instead of starting a new one per upgrade.
 *   - CONFIG FINGERPRINT. The same package with different flags exposes a
 *     different contract (a GitHub server with two toolsets is not the one with
 *     ten). Built from names only — never a credential value — so two machines
 *     on the same team fingerprint the same deployment identically.
 *   - TRUST. A `.mcp.json` committed to a repository is someone else's command
 *     line. Scanning a freshly cloned repo must not execute it just because a
 *     file said so; that is the same rule Claude Code enforces with its own
 *     per-project approval, which is honoured here rather than re-asked.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { classifyServer, mcpConfigPaths, splitSpec } from '../audit/inventory';
import type { ItemSource, McpKind } from '../audit/types';
import { looksLikeSecret } from './redact';

/** Where a server's contract can be looked up publicly, if anywhere. */
export type Registry = 'npm' | 'pypi' | 'docker' | 'remote' | 'local';

/**
 * How to talk to it. `auto` is a bare `url` with no declared type: Streamable
 * HTTP first, SSE on refusal — what Cursor and the SDK docs both do.
 */
export type Transport = 'stdio' | 'http' | 'sse' | 'auto';

/** Which file a server came from, which decides whether it may be launched. */
export type ConfigScope = 'user' | 'project' | 'local';

export interface ServerSpec {
  alias: string;
  transport: Transport;
  command: string | null;
  args: string[];
  env: Record<string, string>;
  cwd: string | null;
  url: string | null;
  headers: Record<string, string>;

  kind: McpKind;
  registry: Registry;
  /** Registry name (npm/PyPI package, Docker image), null for remote/local. */
  packageName: string | null;
  /** Version pinned in the config. Usually null: `npx -y pkg` floats. */
  pinnedVersion: string | null;

  serverKey: string;
  configFingerprint: string;

  scope: ConfigScope;
  trusted: boolean;
  /** Why it is or is not trusted, in words a user can act on. */
  trustReason: string;
  /** `${VAR}` / `${input:x}` references with no value. Launching would fail. */
  unresolved: string[];
  /** Explicitly disabled in its config (`disabled: true`). */
  disabled: boolean;
  /**
   * Every credential-shaped value this spec carries. Never leaves the machine;
   * used to scrub anything the server echoes back before it is stored or sent.
   */
  secrets: string[];
  sources: ItemSource[];
}

export interface ServerConfigResult {
  root: string;
  servers: ServerSpec[];
  filesRead: string[];
  notes: string[];
}

export interface ReadServerOptions {
  home?: string;
  /** Only files inside the project. */
  projectOnly?: boolean;
  /** Launch project-committed servers even without a recorded approval. */
  trustProject?: boolean;
  /** Environment used for `${VAR}` expansion. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
}

interface RawEntry {
  command?: unknown;
  args?: unknown;
  env?: unknown;
  cwd?: unknown;
  url?: unknown;
  httpUrl?: unknown;
  serverUrl?: unknown;
  headers?: unknown;
  type?: unknown;
  transport?: unknown;
  disabled?: unknown;
  enabled?: unknown;
}

/** Values this short are never treated as secrets: they would scrub common words. */
const MIN_SECRET_LENGTH = 6;

/** Arg flags whose following value is a credential. */
const SECRET_FLAG = /^--?(?:api[-_]?key|token|access[-_]?token|auth|password|secret|pat|key)$/i;

/** Env / header names whose value is a credential. */
const SECRET_NAME = /(key|token|secret|password|passwd|auth|cookie|credential|session|pat)\b/i;

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((a): a is string => typeof a === 'string') : [];

const record = (v: unknown): Record<string, string> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string') out[k] = val;
    else if (typeof val === 'number' || typeof val === 'boolean') out[k] = String(val);
  }
  return out;
};

/**
 * Expand `${VAR}`, `${VAR:-default}` and `${env:VAR}` the way Claude Code and
 * VS Code do. `${input:id}` is a VS Code prompt with no value outside the
 * editor, so it is reported unresolved rather than silently emptied — an empty
 * token reads as "auth failed", which is the misleading outcome.
 */
export function expandVars(value: string, env: NodeJS.ProcessEnv, missing: Set<string>): string {
  return value.replace(/\$\{([^}]+)\}/g, (whole, body: string) => {
    if (body.startsWith('input:')) {
      missing.add(body);
      return whole;
    }
    const expr = body.startsWith('env:') ? body.slice(4) : body;
    const [name, fallback] = expr.split(':-', 2) as [string, string | undefined];
    const v = env[name.trim()];
    if (v !== undefined && v !== '') return v;
    if (fallback !== undefined) return fallback;
    missing.add(name.trim());
    return '';
  });
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function hostPath(url: string): string {
  try {
    const u = new URL(url);
    // Query strings are dropped: they are where people put API keys.
    return `${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return url.split('?')[0]!.slice(0, 200);
  }
}

/** PyPI spec → name and version: `pkg==1.2`, `pkg@1.2`, `pkg[extra]>=1`. */
function splitPypi(spec: string): { name: string; version: string | null } {
  const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?(?:(?:==|@)(\d[^\s,;]*))?/.exec(spec);
  if (!m) return { name: spec, version: null };
  return { name: m[1]!.toLowerCase().replace(/_/g, '-'), version: m[2] ?? null };
}

/** Docker image → name without registry noise, and a tag if it looks like a version. */
function splitImage(image: string): { name: string; version: string | null } {
  const noDigest = image.split('@')[0]!;
  const lastColon = noDigest.lastIndexOf(':');
  const hasTag = lastColon > noDigest.lastIndexOf('/');
  const name = hasTag ? noDigest.slice(0, lastColon) : noDigest;
  const tag = hasTag ? noDigest.slice(lastColon + 1) : null;
  return { name: name.toLowerCase(), version: tag && /^v?\d/.test(tag) ? tag : null };
}

/** Docker flags that take a value, so the image is not mistaken for one. */
const DOCKER_VALUE_FLAGS = new Set([
  '-e',
  '--env',
  '-v',
  '--volume',
  '-p',
  '--publish',
  '--name',
  '--network',
  '-w',
  '--workdir',
  '--env-file',
  '-u',
  '--user',
  '--mount',
  '--entrypoint',
  '--platform',
]);

/**
 * Registry identity for a launch command.
 *
 * Builds on `classifyServer` for npm, and fills in the two cases it reports
 * only as "other": PyPI runners and container images. Both have public names,
 * which is what lets two accounts' scans corroborate each other later.
 */
export function identify(
  alias: string,
  command: string | null,
  args: string[],
  url: string | null,
): { kind: McpKind; registry: Registry; packageName: string | null; pinnedVersion: string | null } {
  if (url) return { kind: 'remote', registry: 'remote', packageName: null, pinnedVersion: null };

  // `cmd /c npx …` on Windows: classify what cmd runs.
  let cmd = command ?? '';
  let rest = args;
  if (/^cmd(\.exe)?$/i.test(basename(cmd)) && /^\/c$/i.test(rest[0] ?? '')) {
    cmd = rest[1] ?? '';
    rest = rest.slice(2);
  }
  const bin = basename(cmd).replace(/\.(cmd|exe)$/i, '');

  const base = classifyServer(alias, { command: bin, args: rest });
  if (base.kind === 'npm-stdio' && base.packageName) {
    return {
      kind: base.kind,
      registry: 'npm',
      packageName: base.packageName,
      pinnedVersion: base.version,
    };
  }

  if (bin === 'uvx' || bin === 'pipx' || bin === 'uv') {
    // uvx [--from spec] pkg | pipx run pkg | uv tool run pkg
    let tokens = rest;
    if (bin === 'pipx' && tokens[0] === 'run') tokens = tokens.slice(1);
    if (bin === 'uv' && tokens[0] === 'tool' && tokens[1] === 'run') tokens = tokens.slice(2);
    const from = tokens.indexOf('--from');
    const spec =
      from >= 0
        ? tokens[from + 1]
        : tokens.find((t, i) => !t.startsWith('-') && tokens[i - 1] !== '--python');
    if (spec) {
      const { name, version } = splitPypi(spec);
      return {
        kind: 'other-registry',
        registry: 'pypi',
        packageName: name,
        pinnedVersion: version,
      };
    }
  }

  if ((bin === 'docker' || bin === 'podman') && rest[0] === 'run') {
    for (let i = 1; i < rest.length; i++) {
      const a = rest[i]!;
      if (DOCKER_VALUE_FLAGS.has(a)) {
        i++;
        continue;
      }
      if (a.startsWith('-')) continue;
      const { name, version } = splitImage(a);
      return {
        kind: 'other-registry',
        registry: 'docker',
        packageName: name,
        pinnedVersion: version,
      };
    }
  }

  return { kind: base.kind, registry: 'local', packageName: null, pinnedVersion: null };
}

export function serverKeyFor(
  registry: Registry,
  packageName: string | null,
  url: string | null,
  alias: string,
): string {
  if (registry === 'remote' && url) return `remote:${hostPath(url)}`;
  if (packageName && registry !== 'local' && registry !== 'remote')
    return `${registry}:${packageName}`;
  return `local:${alias}`;
}

/**
 * Credential-shaped values in a spec: env and header values under secret-ish
 * names, values following `--token`-style flags, and anything shaped like a
 * known key format. Returned longest first, so a scrub replaces a whole token
 * before a shorter value that happens to be its prefix.
 */
export function collectSecrets(
  args: string[],
  env: Record<string, string>,
  headers: Record<string, string>,
): string[] {
  const found = new Set<string>();
  const add = (v: string | undefined) => {
    if (!v || v.length < MIN_SECRET_LENGTH) return;
    found.add(v);
    // `Bearer xyz` — the token alone is what a server would echo.
    const bearer = /^(?:bearer|token|basic)\s+(.+)$/i.exec(v);
    if (bearer?.[1] && bearer[1].length >= MIN_SECRET_LENGTH) found.add(bearer[1]);
  };
  for (const [k, v] of Object.entries(env)) if (SECRET_NAME.test(k) || looksLikeSecret(v)) add(v);
  // Every header value: remote servers authenticate there, whatever the name.
  for (const v of Object.values(headers)) add(v);
  args.forEach((a, i) => {
    if (looksLikeSecret(a)) add(a);
    const eq = /^(--?[A-Za-z-_]+)=(.+)$/.exec(a);
    if (eq && SECRET_FLAG.test(eq[1]!)) add(eq[2]);
    if (SECRET_FLAG.test(a)) add(args[i + 1]);
    // docker -e NAME=value
    const kv = /^([A-Z][A-Z0-9_]+)=(.+)$/.exec(a);
    if (kv && SECRET_NAME.test(kv[1]!)) add(kv[2]);
  });
  return [...found].sort((a, b) => b.length - a.length);
}

/**
 * Fingerprint of the configuration that decides WHICH contract a server
 * exposes, built from names and shapes only.
 *
 * Normalised so the same deployment matches across machines and upgrades:
 *   - secret values become `<secret>`, env/header values are dropped entirely
 *   - the home directory becomes `~` and the project root `<project>`
 *   - a pinned version is removed from the package spec — otherwise every
 *     upgrade would start a new history, and history across upgrades is the
 *     whole product
 */
export function fingerprintConfig(
  spec: Pick<
    ServerSpec,
    'transport' | 'command' | 'args' | 'env' | 'headers' | 'url' | 'registry' | 'packageName'
  >,
  secrets: string[],
  root: string,
  home: string,
): string {
  const normPath = (a: string) => {
    let out = a;
    if (root && out.startsWith(root)) out = `<project>${out.slice(root.length)}`;
    if (home && out.startsWith(home)) out = `~${out.slice(home.length)}`;
    return out;
  };
  const args = spec.args.map((a) => {
    if (secrets.includes(a)) return '<secret>';
    const kv = /^([A-Za-z-_][A-Za-z0-9-_]*)=(.*)$/.exec(a);
    if (kv && secrets.includes(kv[2]!)) return `${kv[1]}=<secret>`;
    if (spec.packageName && spec.registry === 'npm' && a.startsWith(spec.packageName))
      return spec.packageName;
    if (spec.packageName && spec.registry === 'pypi' && splitPypi(a).name === spec.packageName) {
      return spec.packageName;
    }
    if (spec.packageName && spec.registry === 'docker' && splitImage(a).name === spec.packageName) {
      return spec.packageName;
    }
    return normPath(a);
  });
  const shape = {
    t: spec.transport,
    c: spec.command ? basename(spec.command) : null,
    a: args,
    e: Object.keys(spec.env).sort(),
    h: Object.keys(spec.headers)
      .map((h) => h.toLowerCase())
      .sort(),
    u: spec.url ? hostPath(spec.url) : null,
  };
  return sha(JSON.stringify(shape)).slice(0, 16);
}

function transportOf(raw: RawEntry, url: string | null, file: string): Transport {
  const declared =
    typeof raw.type === 'string'
      ? raw.type
      : typeof raw.transport === 'string'
        ? raw.transport
        : '';
  const t = declared.toLowerCase().replace(/[-_]/g, '');
  if (t === 'stdio') return 'stdio';
  if (t === 'sse') return 'sse';
  if (t === 'http' || t === 'streamablehttp') return 'http';
  if (typeof raw.httpUrl === 'string') return 'http';
  if (url) {
    // Gemini's `url` is SSE by definition; everyone else's bare url is ambiguous.
    return basename(file) === 'settings.json' && file.includes('.gemini') ? 'sse' : 'auto';
  }
  return 'stdio';
}

interface ClaudeProjectState {
  mcpServers?: Record<string, unknown>;
  enabledMcpjsonServers?: unknown;
  disabledMcpjsonServers?: unknown;
  enableAllProjectMcpServers?: unknown;
}

function readJson(path: string): unknown | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

const canonicalPath = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};

/** Claude Code's record for this project: local-scope servers and approvals. */
function claudeProject(home: string, root: string): ClaudeProjectState | null {
  const cfg = readJson(join(home, '.claude.json')) as {
    projects?: Record<string, ClaudeProjectState>;
  } | null;
  const projects = cfg?.projects;
  if (!projects) return null;
  const want = canonicalPath(root);
  for (const [path, state] of Object.entries(projects)) {
    if (path === root || canonicalPath(path) === want) return state;
  }
  return null;
}

/**
 * Every server the user has configured for this directory, launch-ready.
 *
 * Never throws for a bad file: a malformed config becomes a note, because a
 * scan that dies on one broken entry tells the user nothing about the rest.
 */
export function readServerConfigs(root: string, opts: ReadServerOptions = {}): ServerConfigResult {
  const abs = resolve(root);
  const home = opts.home ?? homedir();
  const env = opts.env ?? process.env;
  const filesRead: string[] = [];
  const notes: string[] = [];
  const rel = (p: string) =>
    isAbsolute(p) && p.startsWith(abs) ? relative(abs, p) || '.' : p.replace(home, '~');

  const project = claudeProject(home, abs);
  const approved = new Set(strings(project?.enabledMcpjsonServers));
  const rejected = new Set(strings(project?.disabledMcpjsonServers));
  const approveAll = project?.enableAllProjectMcpServers === true;

  const entries: {
    alias: string;
    raw: RawEntry;
    file: string;
    section: string;
    scope: ConfigScope;
  }[] = [];

  for (const path of mcpConfigPaths(abs, home)) {
    const inProject = path.startsWith(abs + '/') || path.startsWith(abs + '\\');
    if (opts.projectOnly && !inProject) continue;
    if (!existsSync(path)) continue;
    const cfg = readJson(path);
    if (!cfg || typeof cfg !== 'object') {
      notes.push(`could not parse ${rel(path)}`);
      continue;
    }
    let found = 0;
    for (const section of ['mcpServers', 'servers']) {
      const block = (cfg as Record<string, unknown>)[section];
      if (!block || typeof block !== 'object') continue;
      for (const [alias, raw] of Object.entries(block as Record<string, unknown>)) {
        if (!raw || typeof raw !== 'object') continue;
        entries.push({
          alias,
          raw: raw as RawEntry,
          file: path,
          section,
          scope: inProject ? 'project' : 'user',
        });
        found++;
      }
    }
    if (found) filesRead.push(rel(path));
  }

  // Claude Code's local scope: private to this user, stored in their home file
  // under the project path. `audit/inventory` never read it, so these servers
  // were invisible to every lurq command until now.
  if (!opts.projectOnly && project?.mcpServers && typeof project.mcpServers === 'object') {
    for (const [alias, raw] of Object.entries(project.mcpServers)) {
      if (!raw || typeof raw !== 'object') continue;
      entries.push({
        alias,
        raw: raw as RawEntry,
        file: join(home, '.claude.json'),
        section: `projects[${abs}].mcpServers`,
        scope: 'local',
      });
    }
  }

  const byKey = new Map<string, ServerSpec>();
  for (const { alias, raw, file, section, scope } of entries) {
    const missing = new Set<string>();
    const x = (v: string) => expandVars(v, env, missing);

    const rawUrl =
      typeof raw.httpUrl === 'string'
        ? raw.httpUrl
        : typeof raw.url === 'string'
          ? raw.url
          : typeof raw.serverUrl === 'string'
            ? raw.serverUrl
            : null;
    const url = rawUrl ? x(rawUrl) : null;
    const command = typeof raw.command === 'string' ? x(raw.command) : null;
    const args = strings(raw.args).map(x);
    const envVars = Object.fromEntries(Object.entries(record(raw.env)).map(([k, v]) => [k, x(v)]));
    const headers = Object.fromEntries(
      Object.entries(record(raw.headers)).map(([k, v]) => [k, x(v)]),
    );
    const cwd = typeof raw.cwd === 'string' ? resolve(abs, x(raw.cwd)) : null;
    const transport = transportOf(raw, url, file);

    if (!url && !command) {
      notes.push(`${rel(file)}: server "${alias}" has neither a command nor a url`);
      continue;
    }

    const id = identify(alias, command, args, url);
    const secrets = collectSecrets(args, envVars, headers);
    const serverKey = serverKeyFor(id.registry, id.packageName, url, alias);
    const configFingerprint = fingerprintConfig(
      {
        transport,
        command,
        args,
        env: envVars,
        headers,
        url,
        registry: id.registry,
        packageName: id.packageName,
      },
      secrets,
      abs,
      home,
    );

    let trusted = true;
    let trustReason = scope === 'project' ? 'approved' : 'your own configuration';
    if (scope === 'project') {
      const isMcpJson = basename(file) === '.mcp.json';
      if (isMcpJson && rejected.has(alias)) {
        trusted = false;
        trustReason = 'you declined this server in Claude Code';
      } else if (opts.trustProject) {
        trustReason = 'trusted with --trust-project';
      } else if (isMcpJson && (approveAll || approved.has(alias))) {
        trustReason = 'approved in Claude Code';
      } else {
        trusted = false;
        trustReason = `committed to the repository (${rel(file)}) and not approved; pass --trust-project to launch it`;
      }
    }

    const spec: ServerSpec = {
      alias,
      transport,
      command,
      args,
      env: envVars,
      cwd,
      url,
      headers,
      ...id,
      serverKey,
      configFingerprint,
      scope,
      trusted,
      trustReason,
      unresolved: [...missing].sort(),
      disabled: raw.disabled === true || raw.enabled === false,
      secrets,
      sources: [{ file: rel(file), section }],
    };

    // The same deployment configured in three agents is one thing to scan.
    const key = `${serverKey}#${configFingerprint}`;
    const seen = byKey.get(key);
    if (seen) {
      seen.sources.push(...spec.sources);
      // Identical launch spec: if the user runs it from their own config, the
      // project copy is the same command line and needs no separate approval.
      if (spec.trusted && !seen.trusted) {
        seen.trusted = true;
        seen.trustReason = spec.trustReason;
      }
      seen.disabled &&= spec.disabled;
      continue;
    }
    byKey.set(key, spec);
  }

  return { root: abs, servers: [...byKey.values()], filesRead, notes };
}

export { splitSpec };
