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
 * and Kiro use `{ url, headers }`; Windsurf and Antigravity use
 * `{ serverUrl, headers }`; Gemini CLI uses `{ httpUrl, headers }` (`url` there
 * means SSE); Codex (TOML) uses `url` + an inline `http_headers` table.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DEFAULT_ENDPOINT, PACKAGE_NAME } from '../core/constants';
import { logger } from '../core/logger';
import { packageRoot } from '../core/paths';
import { lurqHome, resolveApiKey } from '../core/userConfig';

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

/**
 * How an agent picks up standing instructions, on top of the MCP entry.
 *
 * The MCP tool descriptions already tell an agent what each tool does; this is
 * what tells it *to reach for lurq at all* rather than answering about a package
 * from memory. Three shapes exist in the wild:
 *
 *  - `skill`: Claude Code's `~/.claude/skills/<name>/SKILL.md`. Its own
 *    directory, loaded on demand when the description matches, so it can carry
 *    the full guide without costing context on every turn.
 *  - `file`: a dedicated file in a directory the agent scans (Kiro steering,
 *    VS Code prompt files). Also ours alone, so we write the full guide.
 *  - `shared`: a single always-loaded context file the user also writes in
 *    (GEMINI.md, AGENTS.md, Windsurf global rules). We own only a marked block
 *    inside it, and keep that block short because it is in every prompt.
 */
type InstructionKind = 'skill' | 'file' | 'shared';

interface InstructionTarget {
  kind: InstructionKind;
  /** Absolute path of the file we write (or upsert a block into). */
  path: string;
}

export interface AgentSpec {
  id: string;
  label: string;
  format: ConfigFormat;
  /** Absolute config file path. */
  path: string;
  /** Whether this agent appears installed (used by `--agent all` and the wizard). */
  detected: boolean;
  /** Where this agent reads standing instructions, when it has such a place. */
  instructions?: InstructionTarget;
}

function home(...p: string[]): string {
  return join(homedir(), ...p);
}

/**
 * VS Code's user-data directory, which is per-platform:
 *   macOS   ~/Library/Application Support/Code/User
 *   Windows %APPDATA%\Code\User
 *   Linux   $XDG_CONFIG_HOME/Code/User (default ~/.config/Code/User)
 * Hardcoding the macOS path made detection always false elsewhere — and
 * `--agent copilot` write a config nobody reads.
 */
function vscodeUserDir(): string {
  if (process.platform === 'darwin') return home('Library', 'Application Support', 'Code', 'User');
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? home('AppData', 'Roaming'), 'Code', 'User');
  }
  return join(process.env.XDG_CONFIG_HOME || home('.config'), 'Code', 'User');
}

export function agentSpecs(): AgentSpec[] {
  return [
    {
      id: 'claude-code',
      label: 'Claude Code',
      format: 'mcpServers',
      path: home('.claude.json'),
      detected: existsSync(home('.claude.json')) || existsSync(home('.claude')),
      // Personal skills are read from ~/.claude/skills/<name>/SKILL.md and apply
      // across every project, which is exactly the scope a global install wants.
      instructions: { kind: 'skill', path: home('.claude', 'skills', 'lurq', 'SKILL.md') },
    },
    {
      // No instructions target: Cursor's user-level rules live in its settings
      // UI, not a file on disk, and its `.cursor/rules/*.mdc` files are
      // per-project, so there is nothing a machine-wide install can write once.
      // The MCP tool descriptions carry the guidance here.
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
      instructions: {
        kind: 'shared',
        path: home('.codeium', 'windsurf', 'memories', 'global_rules.md'),
      },
    },
    {
      id: 'copilot',
      label: 'VS Code / GitHub Copilot',
      format: 'servers',
      path: join(vscodeUserDir(), 'mcp.json'),
      detected: existsSync(vscodeUserDir()),
      instructions: { kind: 'file', path: join(vscodeUserDir(), 'prompts', 'lurq.instructions.md') },
    },
    {
      id: 'codex',
      label: 'OpenAI Codex CLI',
      format: 'toml',
      path: home('.codex', 'config.toml'),
      detected: existsSync(home('.codex')),
      instructions: { kind: 'shared', path: home('.codex', 'AGENTS.md') },
    },
    {
      id: 'gemini-cli',
      label: 'Gemini CLI',
      format: 'mcpServers',
      path: home('.gemini', 'settings.json'),
      detected: existsSync(home('.gemini', 'settings.json')),
      // ~/.gemini/GEMINI.md is the global tier of the context hierarchy, loaded
      // ahead of any workspace file.
      instructions: { kind: 'shared', path: home('.gemini', 'GEMINI.md') },
    },
    {
      // Shares the ~/.gemini root with the Gemini CLI but keeps its own file, so
      // detection has to look at the file rather than at the directory. It reads
      // the same global GEMINI.md; upserting the block twice is a no-op, so
      // having both selected is harmless.
      id: 'antigravity',
      label: 'Google Antigravity',
      format: 'mcpServers',
      path: home('.gemini', 'config', 'mcp_config.json'),
      detected: existsSync(home('.gemini', 'config')),
      instructions: { kind: 'shared', path: home('.gemini', 'GEMINI.md') },
    },
    {
      id: 'kiro',
      label: 'Kiro',
      format: 'mcpServers',
      path: home('.kiro', 'settings', 'mcp.json'),
      detected: existsSync(home('.kiro')),
      // Steering files in ~/.kiro/steering apply to every workspace and are
      // always included.
      instructions: { kind: 'file', path: home('.kiro', 'steering', 'lurq.md') },
    },
  ];
}

export const SUPPORTED_AGENTS = [
  'claude-code',
  'cursor',
  'windsurf',
  'copilot',
  'codex',
  'gemini-cli',
  'antigravity',
  'kiro',
] as const;

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
  /** Where the standing-instructions file landed, when the agent supports one. */
  instructionsPath?: string;
}

function readJsonObject(path: string): Record<string, any> {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, 'utf8').trim();
  if (!text) return {};
  return JSON.parse(text);
}

/**
 * Write via a temp file + rename, which is atomic within a directory. These are
 * the user's own agent configs — `~/.claude.json` holds Claude Code's entire
 * project state — and a crash partway through a plain write truncates the file.
 * A reader sees either the old config or the new one, never a half-written one.
 */
function writeFileAtomic(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.lurq-${process.pid}.tmp`;
  try {
    writeFileSync(tmp, contents, 'utf8');
    renameSync(tmp, path);
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* best-effort cleanup; report the original failure */
    }
    throw err;
  }
}

function writeJson(path: string, obj: unknown): void {
  writeFileAtomic(path, JSON.stringify(obj, null, 2) + '\n');
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
 * Claude Code & VS Code take `type:"http"`; the rest infer transport from which
 * URL field is set — `url` (Cursor, Kiro), `serverUrl` (Windsurf, Antigravity),
 * or `httpUrl` (Gemini CLI, where a plain `url` would be read as an SSE
 * endpoint and the streamable-HTTP handshake would never happen).
 */
export function buildRemoteServerEntry(
  agentId: string,
  opts: { url: string; apiKey: string },
): Record<string, any> {
  const headers = { Authorization: `Bearer ${opts.apiKey}` };
  switch (agentId) {
    case 'cursor':
    case 'kiro':
      return { url: opts.url, headers };
    case 'windsurf':
    case 'antigravity':
      return { serverUrl: opts.url, headers };
    case 'gemini-cli':
      return { httpUrl: opts.url, headers };
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

/**
 * Drop the existing `[mcp_servers.lurq]` table (its header through the line
 * before the next top-level `[`), leaving every other table untouched. Enough
 * TOML awareness to replace our own block without taking a parser dependency:
 * we only ever need to find one section we wrote ourselves.
 */
export function stripTomlBlock(text: string, header = '[mcp_servers.lurq]'): string {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === header);
  if (start === -1) return text;
  let end = start + 1;
  // Sub-tables ([mcp_servers.lurq.env]) belong to the block; a sibling table ends it.
  while (end < lines.length) {
    const t = lines[end]!.trim();
    if (t.startsWith('[') && !t.startsWith(`${header.slice(0, -1)}.`)) break;
    end++;
  }
  return [...lines.slice(0, start), ...lines.slice(end)].join('\n').replace(/\n{3,}/g, '\n\n');
}

function installTomlBlock(spec: AgentSpec, block: string): InstallResult {
  const current = existsSync(spec.path) ? readFileSync(spec.path, 'utf8') : '';
  // Replace, never skip: skipping meant a re-run after a key rotation left
  // Codex pointed at the dead key while reporting success. Every other agent
  // upserts its entry, so this one does too.
  const existing = stripTomlBlock(current).replace(/\s+$/, '');
  const sep = existing ? '\n\n' : '';
  writeFileAtomic(spec.path, existing + sep + block);
  return {
    agent: spec.id,
    path: spec.path,
    status: 'installed',
    message: current.includes('[mcp_servers.lurq]') ? 'replaced the existing lurq entry' : undefined,
  };
}

// ── Standing instructions ────────────────────────────────────────────────────

/** Delimit the block we own inside a context file the user also writes in, so a
 *  re-run replaces our text and leaves theirs alone. HTML comments render as
 *  nothing in every markdown viewer these agents use. */
const BLOCK_START = '<!-- lurq:start -->';
const BLOCK_END = '<!-- lurq:end -->';

/** One-line trigger description for the Claude Code skill's frontmatter. This is
 *  the only part loaded on every turn, so it has to say when to reach for lurq
 *  without the body. */
const SKILL_DESCRIPTION =
  'Get current, evidence-scored facts about npm packages instead of recalling them. ' +
  'Use before adding, choosing, comparing, or upgrading any JS/TS dependency, before ' +
  'hand-rolling something a package may already do, and before writing code against a ' +
  "package API that may have moved since training. Covers hallucinated and typosquatted " +
  'package names, advisories, version-exact export surfaces, and stack compatibility.';

function template(name: string): string | null {
  const src = join(packageRoot(), 'templates', name);
  return existsSync(src) ? readFileSync(src, 'utf8') : null;
}

/**
 * Replace the `<!-- lurq:start -->…<!-- lurq:end -->` block in `text`, or append
 * one if it isn't there yet.
 *
 * Idempotent by construction: this is how a second `lurq setup` (or a key
 * rotation) updates a shared context file without stacking duplicate copies of
 * our instructions on top of the user's own rules. A start marker with no end
 * marker means someone edited the file by hand and cut it in half, so treat the
 * rest of the file as ours to replace rather than leaving an orphaned marker.
 */
export function upsertMarkedBlock(text: string, block: string): string {
  const wrapped = `${BLOCK_START}\n${block.trim()}\n${BLOCK_END}`;
  const start = text.indexOf(BLOCK_START);
  if (start === -1) {
    const existing = text.replace(/\s+$/, '');
    return existing ? `${existing}\n\n${wrapped}\n` : `${wrapped}\n`;
  }
  const endAt = text.indexOf(BLOCK_END, start);
  const after = endAt === -1 ? '' : text.slice(endAt + BLOCK_END.length);
  return `${text.slice(0, start)}${wrapped}${after.replace(/^\n*/, '\n')}`;
}

/** The `~/.claude/skills/lurq/SKILL.md` body: frontmatter + the full guide. */
export function buildSkillFile(guide: string): string {
  return [
    '---',
    'name: lurq',
    `description: ${SKILL_DESCRIPTION}`,
    '---',
    '',
    guide.trim(),
    '',
  ].join('\n');
}

/**
 * Write the agent's standing-instructions file. Returns the path, or null when
 * the agent has no such place (Cursor) or the template is missing from the
 * install. Never throws for a missing directory: every target is created.
 */
export function installInstructions(spec: AgentSpec): string | null {
  const target = spec.instructions;
  if (!target) return null;

  if (target.kind === 'shared') {
    // Always-loaded file: keep it to the short brief, and merge rather than
    // overwrite, because the user's own global rules live in here too.
    const brief = template('agent-rules.md');
    if (!brief) return null;
    const current = existsSync(target.path) ? readFileSync(target.path, 'utf8') : '';
    writeFileAtomic(target.path, upsertMarkedBlock(current, brief));
    return target.path;
  }

  // Ours alone, and loaded on demand, so the full guide fits.
  const guide = template('skill-instructions.md');
  if (!guide) return null;
  writeFileAtomic(target.path, target.kind === 'skill' ? buildSkillFile(guide) : guide);
  return target.path;
}

/** Apply the lurq entry to one agent's config, in the given mode. */
export function installAgent(spec: AgentSpec, mode: InstallMode): InstallResult {
  try {
    const result =
      spec.format === 'toml'
        ? installTomlBlock(
            spec,
            mode.kind === 'remote' ? buildRemoteTomlBlock(mode) : buildTomlBlock(mode.env),
          )
        : installJsonEntry(
            spec,
            mode.kind === 'remote'
              ? buildRemoteServerEntry(spec.id, mode)
              : buildServerEntry(mode.env, spec.format === 'servers'),
          );
    // The MCP entry is the part that must land; a failure to write instructions
    // (a read-only rules file, say) degrades the install rather than voiding it.
    try {
      result.instructionsPath = installInstructions(spec) ?? undefined;
    } catch (err) {
      result.message = `MCP entry written; instructions file failed: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
    return result;
  } catch (err) {
    return {
      agent: spec.id,
      path: spec.path,
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Copy the skill-instructions template to ~/.lurq. Returns the path, or null.
 *  The canonical copy, for agents with no instructions target of their own and
 *  for anyone who wants to read what was installed. */
export function installInstructionsFile(): string | null {
  const src = join(packageRoot(), 'templates', 'skill-instructions.md');
  if (!existsSync(src)) return null;
  const destDir = lurqHome();
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
  const short = (p: string) => (p.startsWith(homedir()) ? `~${p.slice(homedir().length)}` : p);

  console.log('lurq MCP server registration:');
  for (const r of results) {
    const spec = specs.find((s) => s.id === r.agent)!;
    const mark = r.status === 'installed' ? '✓' : r.status === 'skipped' ? '•' : '✗';
    console.log(
      `  ${mark} ${spec.label.padEnd(26)} ${short(r.path)}${r.message ? `  (${r.message})` : ''}`,
    );
  }

  const withSkills = results.filter((r) => r.instructionsPath);
  if (withSkills.length) {
    console.log('\nAgent instructions (so it reaches for lurq on its own):');
    for (const r of withSkills) {
      const spec = specs.find((s) => s.id === r.agent)!;
      console.log(`  ✓ ${spec.label.padEnd(26)} ${short(r.instructionsPath!)}`);
    }
  }
  if (instructionsPath) console.log(`\nFull guide: ${short(instructionsPath)}`);

  console.log('\nNext steps:');
  if (mode.kind === 'local') {
    console.log('  1. Ensure DATABASE_URL (and any API keys) are set in the config env above.');
    console.log('  2. Restart the agent so it picks up the new MCP server.');
  } else {
    console.log('  1. Restart the agent so it picks up the new MCP server.');
  }
  console.log('  • Ask it to recommend a library. It should call lurq.');
  console.log('  • Or use the terminal directly: `lurq recommend "a form library for React"`.');
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
    const apiKey = resolveApiKey(opts.apiKey);
    if (!apiKey) {
      throw new Error(
        'An API key is required for a hosted install. Pass --api-key <key> (or set LURQ_API_KEY), ' +
          'or run `lurq setup` for the guided setup, or --local to self-host.',
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
