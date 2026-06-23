/**
 * Agent skill installer (§14). Registers lurq as an MCP server in supported
 * assistants by MERGING a single `lurq` entry into each agent's config — never
 * overwriting unrelated config — and drops the skill-instructions file.
 *
 * MCP config formats move fast and differ per agent; this writes the current
 * widely-supported shapes and prints exactly what it did + a manual fallback,
 * so a stale path is obvious rather than silent.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { PACKAGE_NAME } from '../core/constants';
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

type ConfigFormat = 'mcpServers' | 'servers' | 'toml';

interface AgentSpec {
  id: string;
  label: string;
  format: ConfigFormat;
  /** Absolute config file path. */
  path: string;
  /** Whether this agent appears installed (used by --agent all). */
  detected: boolean;
}

function home(...p: string[]): string {
  return join(homedir(), ...p);
}

function agentSpecs(): AgentSpec[] {
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

function collectEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ENV_KEYS) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return env;
}

interface InstallResult {
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

/** The lurq server entry for JSON configs. */
export function buildServerEntry(env: Record<string, string>, withType: boolean): Record<string, any> {
  const entry: Record<string, any> = { command: 'npx', args: ['-y', PACKAGE_NAME, 'serve'] };
  if (withType) entry.type = 'stdio';
  if (Object.keys(env).length) entry.env = env;
  return entry;
}

function installJson(spec: AgentSpec, env: Record<string, string>): InstallResult {
  const key = spec.format === 'servers' ? 'servers' : 'mcpServers';
  const config = readJsonObject(spec.path);
  if (typeof config[key] !== 'object' || config[key] === null) config[key] = {};
  config[key].lurq = buildServerEntry(env, spec.format === 'servers');
  writeJson(spec.path, config);
  return { agent: spec.id, path: spec.path, status: 'installed' };
}

/** Build a TOML block for the Codex config. */
export function buildTomlBlock(env: Record<string, string>): string {
  const lines = ['[mcp_servers.lurq]', 'command = "npx"', `args = ["-y", "${PACKAGE_NAME}", "serve"]`];
  if (Object.keys(env).length) {
    lines.push('', '[mcp_servers.lurq.env]');
    for (const [k, v] of Object.entries(env)) lines.push(`${k} = ${JSON.stringify(v)}`);
  }
  return lines.join('\n') + '\n';
}

function installToml(spec: AgentSpec, env: Record<string, string>): InstallResult {
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
  writeFileSync(spec.path, existing + sep + buildTomlBlock(env), 'utf8');
  return { agent: spec.id, path: spec.path, status: 'installed' };
}

function installInstructionsFile(): string | null {
  const src = join(packageRoot(), 'templates', 'skill-instructions.md');
  if (!existsSync(src)) return null;
  const destDir = home('.lurq');
  const dest = join(destDir, 'skill-instructions.md');
  mkdirSync(destDir, { recursive: true });
  copyFileSync(src, dest);
  return dest;
}

export interface InstallSkillOptions {
  agent?: string;
}

export async function runInstallSkill(opts: InstallSkillOptions): Promise<void> {
  const target = opts.agent ?? 'claude-code';
  const specs = agentSpecs();
  const env = collectEnv();

  let selected: AgentSpec[];
  if (target === 'all') {
    selected = specs.filter((s) => s.detected);
    if (selected.length === 0) {
      console.log('No supported agents detected on this machine.');
      return;
    }
  } else {
    const spec = specs.find((s) => s.id === target);
    if (!spec) {
      throw new Error(
        `Unknown agent "${target}". Supported: ${SUPPORTED_AGENTS.join(', ')}, all.`,
      );
    }
    selected = [spec];
  }

  if (!env.DATABASE_URL) {
    logger.warn(
      'DATABASE_URL is not set in the current environment — the installed server entry will have no DATABASE_URL. Set it (in .env) and re-run, or edit the config.',
    );
  }

  const results: InstallResult[] = [];
  for (const spec of selected) {
    try {
      results.push(spec.format === 'toml' ? installToml(spec, env) : installJson(spec, env));
    } catch (err) {
      results.push({
        agent: spec.id,
        path: spec.path,
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const instructionsPath = installInstructionsFile();

  // Report.
  console.log('lurq MCP server registration:');
  for (const r of results) {
    const spec = specs.find((s) => s.id === r.agent)!;
    const mark = r.status === 'installed' ? '✓' : r.status === 'skipped' ? '•' : '✗';
    console.log(`  ${mark} ${spec.label.padEnd(26)} ${r.path}${r.message ? `  (${r.message})` : ''}`);
  }
  if (instructionsPath) console.log(`\nSkill instructions written to ${instructionsPath}`);
  console.log('\nNext steps:');
  console.log('  1. Ensure DATABASE_URL (and any API keys) are set in the config env above.');
  console.log('  2. Restart the agent so it picks up the new MCP server.');
  console.log('  3. Ask it to recommend a library — it should call lurq.');
}
