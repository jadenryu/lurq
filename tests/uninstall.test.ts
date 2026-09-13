/**
 * Setup writes into files other tools own; uninstall must take back exactly
 * what setup added. Both run against a throwaway HOME.
 */
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  agentSpecs,
  installAgent,
  claudeSettingsPath,
  installClaudeHook,
  installInstructionsFile,
  removeMarkedBlock,
  upsertMarkedBlock,
  type InstallMode,
} from '../src/cli/installSkill';
import { runUninstall } from '../src/cli/uninstall';
import { readUserConfig, userConfigPath, writeUserConfig } from '../src/core/userConfig';

const mode: InstallMode = { kind: 'remote', url: 'https://api.lurq.run/mcp', apiKey: 'lurq_live_x' };
const spec = (id: string) => agentSpecs().find((s) => s.id === id)!;
const put = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

let home: string;
const savedHome = process.env.HOME;
const savedLurqHome = process.env.LURQ_HOME;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'lurq-uninstall-home-'));
  process.env.HOME = home;
  process.env.LURQ_HOME = join(home, '.lurq');
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env.HOME = savedHome;
  process.env.LURQ_HOME = savedLurqHome;
  process.exitCode = undefined;
});

describe('lurq uninstall', () => {
  const claudeJson = JSON.stringify({ projects: { '/a': {} }, mcpServers: { other: { command: 'x' } } });
  const codexToml = '[mcp_servers.other]\ncommand = "x"\n';
  const geminiRules = '# My rules\n\nBe terse.\n';

  function setUp(): void {
    put(join(home, '.claude.json'), claudeJson);
    put(join(home, '.codex', 'config.toml'), codexToml);
    put(join(home, '.gemini', 'GEMINI.md'), geminiRules);
    for (const id of ['claude-code', 'codex', 'gemini-cli', 'antigravity', 'kiro']) {
      expect(installAgent(spec(id), mode).status).toBe('installed');
    }
    installInstructionsFile();
    writeUserConfig({ apiKey: 'lurq_live_x' });
  }

  it('removes only what setup wrote, and gives shared files back as they were', async () => {
    setUp();
    await runUninstall({ yes: true });

    const claude = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8'));
    expect(claude.mcpServers).toEqual({ other: { command: 'x' } });
    expect(claude.projects).toEqual({ '/a': {} });
    expect(readFileSync(join(home, '.codex', 'config.toml'), 'utf8')).toBe(codexToml);
    expect(readFileSync(join(home, '.gemini', 'GEMINI.md'), 'utf8')).toBe(geminiRules);
    // Codex's AGENTS.md held nothing but our block, so it goes.
    expect(existsSync(join(home, '.codex', 'AGENTS.md'))).toBe(false);
    expect(JSON.parse(readFileSync(spec('antigravity').path, 'utf8')).mcpServers).toEqual({});

    expect(existsSync(join(home, '.claude', 'skills', 'lurq'))).toBe(false);
    expect(existsSync(join(home, '.kiro', 'steering', 'lurq.md'))).toBe(false);
    expect(existsSync(userConfigPath())).toBe(false);
    expect(existsSync(join(home, '.lurq'))).toBe(false);
    expect(process.exitCode).toBeUndefined();
  });

  it('with --agent, leaves every other agent and the stored key alone', async () => {
    setUp();
    await runUninstall({ agent: 'codex', yes: true });

    expect(readFileSync(join(home, '.codex', 'config.toml'), 'utf8')).toBe(codexToml);
    expect(JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8')).mcpServers.lurq).toBeTruthy();
    expect(readUserConfig().apiKey).toBe('lurq_live_x');
  });

  it('takes the hooks out of Claude Code settings and keeps the user’s own', async () => {
    const settings = { hooks: { PreToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'fmt' }] }] } };
    put(claudeSettingsPath(), JSON.stringify(settings));
    expect(installClaudeHook(claudeSettingsPath(), { command: 'lurq', onPath: true })).toBe(claudeSettingsPath());
    expect(installClaudeHook(undefined, { command: 'npx lurqrun', onPath: false })).toBeNull();

    await runUninstall({ agent: 'claude-code', yes: true });
    expect(JSON.parse(readFileSync(claudeSettingsPath(), 'utf8'))).toEqual(settings);
  });

  it('refuses to act without --yes when nobody can answer the prompt', async () => {
    setUp();
    await expect(runUninstall({})).rejects.toThrow(/--yes/);
    expect(JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8')).mcpServers.lurq).toBeTruthy();
  });
});

describe('writing agent configs', () => {
  it('writes through a dotfiles symlink and keeps the file owner-only', () => {
    const real = join(home, 'dotfiles', 'cursor-mcp.json');
    put(real, '{"mcpServers":{}}\n');
    chmodSync(real, 0o600);
    const link = spec('cursor').path;
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(real, link);

    expect(installAgent(spec('cursor'), mode).status).toBe('installed');

    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(JSON.parse(readFileSync(real, 'utf8')).mcpServers.lurq.url).toBe(mode.url);
    expect(statSync(real).mode & 0o777).toBe(0o600);
  });

  it('creates a new config that holds the key as 0600', () => {
    installAgent(spec('kiro'), mode);
    expect(statSync(spec('kiro').path).mode & 0o777).toBe(0o600);
  });

  it('explains a config with comments instead of printing a JSON parse error', () => {
    put(spec('cursor').path, '// my servers\n{ "mcpServers": {} }\n');
    const result = installAgent(spec('cursor'), mode);
    expect(result.status).toBe('error');
    expect(result.message).toMatch(/not plain JSON.*comments/);
  });
});

describe('removeMarkedBlock', () => {
  it('undoes upsertMarkedBlock', () => {
    for (const original of ['', '# Mine\n', '# Mine\n\nmore\n']) {
      expect(removeMarkedBlock(upsertMarkedBlock(original, 'use lurq'))).toBe(original);
    }
  });
});
