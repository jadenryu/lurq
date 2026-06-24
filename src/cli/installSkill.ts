/**
 * Agent skill installer (§14). Registers lurq as an MCP server in supported
 * assistants by MERGING a single `lurq` entry into each agent's config — never
 * overwriting unrelated config — and drops the skill-instructions file.
 *
 * Two modes:
 *  - **remote** (hosted, default for real users): writes a keyed HTTP entry
 *    pointing at the lurq service. No DATABASE_URL ever touches a user's machine.
 *  - **local** (self-host / contributors): writes the legacy stdio entry that
 *    runs `lurq serve` locally against the user's own DB.
 *
 * MCP config formats move fast and differ per agent; this writes the current
 * widely-supported shapes and prints exactly what it did, so a stale path is
 * obvious rather than silent. Remote shapes verified against current agent docs
 * (2026-06): Claude Code / VS Code use `{ type:"http", url, headers }`; Cursor
 * uses `{ url, headers }`; Windsurf uses `{ serverUrl, headers }`; Codex (TOML)
 * uses `url` + an inline `http_headers` table.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DEFAULT_ENDPOINT, PACKAGE_NAME } from '../core/constants';
import { logger } from '../core/logger';
import { packageRoot } from '../core/paths';

const ENV_KEYS = [
  'DATABASE_URL',
  'GITHUB_TOKEN',
  'EMBEDDING_PROVIDER',
  'EMBEDDING_API_KEY',
  'EMBEDDING_MODEL',
  'SUMMARY_PROVIDER',
  'SUMMARY_API_KEY',
  'SUMMARY_MODEL',
] as const;

export type ConfigFormat = 'mcpServers' | 'servers' | 'toml';

export interface AgentSpec {
  id: string;
  label: string;
  format: ConfigFormat;
  /** Absolute config file path. */
  path: string;
  /** Whether this agent appears installed (used by `--agent all` and the wizard). */
  detected: boolean;
}

function home(...p: string[]): string {
  return join(homedir(), ...p);
}

export function agentSpecs(): AgentSpec[] {
  return [
    {
      id: 'claude-code',
      label: 'Claude Code',
      format: 'mcpServers',
      path: home('.claude.json'),
      detected: existsSync(home('.claude.json')) || existsSync(home('.claude')),
    },
    {
      id: 'cursor',
      label: 'Cursor',
      format: 'mcpServers',
      path: home('.cursor', 'mcp.json'),
      detected: existsSync(home('.cursor')),
    },
    {
      id: 'windsurf',
      label: 'Windsurf',
      format: 'mcpServers',
      path: home('.codeium', 'windsurf', 'mcp_config.json'),
      detected: existsSync(home('.codeium')),
    },
    {
      id: 'copilot',
      label: 'VS Code / GitHub Copilot',
      format: 'servers',
      path: home('Library', 'Application Support', 'Code', 'User', 'mcp.json'),
      detected: existsSync(home('Library', 'Application Support', 'Code', 'User')),
    },
    {
      id: 'codex',
      label: 'OpenAI Codex CLI',
      format: 'toml',
      path: home('.codex', 'config.toml'),
      detected: existsSync(home('.codex')),
    },
  ];
}

export const SUPPORTED_AGENTS = ['claude-code', 'cursor', 'windsurf', 'copilot', 'codex'] as const;

/** How to wire the lurq entry: hosted HTTP endpoint, or local stdio process. */
export type InstallMode =
  | { kind: 'remote'; url: string; apiKey: string }
  | { kind: 'local'; env: Record<string, string> };

function collectEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ENV_KEYS) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return env;
}

export interface InstallResult {
  agent: string;
  path: string;
  status: 'installed' | 'skipped' | 'error';
  message?: string;
}

function readJsonObject(path: string): Record<string, any> {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, 'utf8').trim();
  if (!text) return {};
  return JSON.parse(text);
}

function writeJson(path: string, obj: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

/** Local (stdio) lurq server entry for JSON configs. */
export function buildServerEntry(env: Record<string, string>, withType: boolean): Record<string, any> {
  const entry: Record<string, any> = { command: 'npx', args: ['-y', PACKAGE_NAME, 'serve'] };
  if (withType) entry.type = 'stdio';
  if (Object.keys(env).length) entry.env = env;
  return entry;
}

/**
 * Remote (hosted) lurq server entry for JSON configs. Per-agent shape differs:
 * Claude Code & VS Code take `type:"http"`; Cursor & Windsurf infer transport
 * from the URL (Windsurf names the field `serverUrl`).
 */
export function buildRemoteServerEntry(
  agentId: string,
  opts: { url: string; apiKey: string },
): Record<string, any> {
  const headers = { Authorization: `Bearer ${opts.apiKey}` };
  switch (agentId) {
    case 'cursor':
      return { url: opts.url, headers };
    case 'windsurf':
      return { serverUrl: opts.url, headers };
    case 'claude-code':
    case 'copilot':
    default:
      return { type: 'http', url: opts.url, headers };
  }
}

/** Local (stdio) TOML block for the Codex config. */
export function buildTomlBlock(env: Record<string, string>): string {
  const lines = ['[mcp_servers.lurq]', 'command = "npx"', `args = ["-y", "${PACKAGE_NAME}", "serve"]`];
  if (Object.keys(env).length) {
    lines.push('', '[mcp_servers.lurq.env]');
    for (const [k, v] of Object.entries(env)) lines.push(`${k} = ${JSON.stringify(v)}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * Remote (hosted) TOML block for the Codex config. Codex parses with
 * `deny_unknown_fields`: literal headers go in an inline `http_headers` table,
 * NOT a `[mcp_servers.lurq.headers]` subtable (verified against the openai/codex
 * StreamableHttp config schema).
 */
export function buildRemoteTomlBlock(opts: { url: string; apiKey: string }): string {
  return (
    [
      '[mcp_servers.lurq]',
      `url = ${JSON.stringify(opts.url)}`,
      `http_headers = { Authorization = ${JSON.stringify(`Bearer ${opts.apiKey}`)} }`,
    ].join('\n') + '\n'
  );
}

function installJsonEntry(spec: AgentSpec, entry: Record<string, any>): InstallResult {
  const key = spec.format === 'servers' ? 'servers' : 'mcpServers';
  const config = readJsonObject(spec.path);
  if (typeof config[key] !== 'object' || config[key] === null) config[key] = {};
  config[key].lurq = entry;
  writeJson(spec.path, config);
  return { agent: spec.id, path: spec.path, status: 'installed' };
}

function installTomlBlock(spec: AgentSpec, block: string): InstallResult {
  const existing = existsSync(spec.path) ? readFileSync(spec.path, 'utf8') : '';
  if (existing.includes('[mcp_servers.lurq]')) {
    return {
      agent: spec.id,
      path: spec.path,
      status: 'skipped',
      message: 'lurq already present; edit manually to change it.',
    };
  }
  mkdirSync(dirname(spec.path), { recursive: true });
  const sep = existing && !existing.endsWith('\n') ? '\n\n' : existing ? '\n' : '';
  writeFileSync(spec.path, existing + sep + block, 'utf8');
  return { agent: spec.id, path: spec.path, status: 'installed' };
}

/** Apply the lurq entry to one agent's config, in the given mode. */
export function installAgent(spec: AgentSpec, mode: InstallMode): InstallResult {
  try {
    if (spec.format === 'toml') {
      const block =
        mode.kind === 'remote'
          ? buildRemoteTomlBlock(mode)
          : buildTomlBlock(mode.env);
      return installTomlBlock(spec, block);
    }
    const entry =
      mode.kind === 'remote'
        ? buildRemoteServerEntry(spec.id, mode)
        : buildServerEntry(mode.env, spec.format === 'servers');
    return installJsonEntry(spec, entry);
  } catch (err) {
    return {
      agent: spec.id,
      path: spec.path,
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Copy the skill-instructions template to ~/.lurq. Returns the path, or null. */
export function installInstructionsFile(): string | null {
  const src = join(packageRoot(), 'templates', 'skill-instructions.md');
  if (!existsSync(src)) return null;
  const destDir = home('.lurq');
  const dest = join(destDir, 'skill-instructions.md');
  mkdirSync(destDir, { recursive: true });
  copyFileSync(src, dest);
  return dest;
}

/** Resolve `--agent <id|all>` to the set of agent specs to write. */
export function resolveAgents(target: string): AgentSpec[] {
  const specs = agentSpecs();
  if (target === 'all') return specs.filter((s) => s.detected);
  const spec = specs.find((s) => s.id === target);
  if (!spec) {
    throw new Error(`Unknown agent "${target}". Supported: ${SUPPORTED_AGENTS.join(', ')}, all.`);
  }
  return [spec];
}

/** Print the per-agent registration report + next steps. Shared by both paths. */
export function printInstallReport(
  results: InstallResult[],
  instructionsPath: string | null,
  mode: InstallMode,
): void {
  const specs = agentSpecs();
  console.log('lurq MCP server registration:');
  for (const r of results) {
    const spec = specs.find((s) => s.id === r.agent)!;
    const mark = r.status === 'installed' ? '✓' : r.status === 'skipped' ? '•' : '✗';
    console.log(`  ${mark} ${spec.label.padEnd(26)} ${r.path}${r.message ? `  (${r.message})` : ''}`);
  }
  if (instructionsPath) console.log(`\nSkill instructions written to ${instructionsPath}`);
  console.log('\nNext steps:');
  if (mode.kind === 'local') {
    console.log('  1. Ensure DATABASE_URL (and any API keys) are set in the config env above.');
    console.log('  2. Restart the agent so it picks up the new MCP server.');
  } else {
    console.log('  1. Restart the agent so it picks up the new MCP server.');
  }
  console.log('  • Ask it to recommend a library — it should call lurq.');
}

export interface InstallSkillOptions {
  agent?: string;
  /** Hosted endpoint URL (defaults to LURQ_ENDPOINT or the built-in default). */
  url?: string;
  /** API key for the hosted endpoint. Presence selects remote mode. */
  apiKey?: string;
  /** Force the legacy local/stdio entry (self-host). */
  local?: boolean;
}

export async function runInstallSkill(opts: InstallSkillOptions): Promise<void> {
  const selected = resolveAgents(opts.agent ?? 'claude-code');
  if (selected.length === 0) {
    console.log('No supported agents detected on this machine.');
    return;
  }

  // Remote unless explicitly --local. Remote requires an API key.
  const remote = !opts.local;
  let mode: InstallMode;
  if (remote) {
    const apiKey = opts.apiKey ?? process.env.LURQ_API_KEY;
    if (!apiKey) {
      throw new Error(
        'An API key is required for a hosted install. Pass --api-key <key> (or set LURQ_API_KEY), ' +
          'or use `lurq install` for the guided setup, or --local to self-host.',
      );
    }
    const url = opts.url ?? process.env.LURQ_ENDPOINT ?? DEFAULT_ENDPOINT;
    mode = { kind: 'remote', url, apiKey };
  } else {
    const env = collectEnv();
    if (!env.DATABASE_URL) {
      logger.warn(
        'DATABASE_URL is not set — the local server entry will have no DATABASE_URL. ' +
          'Set it (in .env) and re-run, or edit the config.',
      );
    }
    mode = { kind: 'local', env };
  }

  const results = selected.map((spec) => installAgent(spec, mode));
  const instructionsPath = installInstructionsFile();
  printInstallReport(results, instructionsPath, mode);
}
