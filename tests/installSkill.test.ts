import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  agentSpecs,
  buildServerEntry,
  buildSkillFile,
  buildTomlBlock,
  buildRemoteServerEntry,
  buildRemoteTomlBlock,
  installInstructions,
  resolveAgents,
  stripTomlBlock,
  upsertMarkedBlock,
  SUPPORTED_AGENTS,
  type AgentSpec,
} from '../src/cli/installSkill';

describe('buildServerEntry', () => {
  it('builds the standard npx stdio entry with env', () => {
    expect(buildServerEntry({ DATABASE_URL: 'postgres://x' }, false)).toEqual({
      command: 'npx',
      args: ['-y', 'lurqrun', 'serve'],
      env: { DATABASE_URL: 'postgres://x' },
    });
  });

  it('adds type:stdio for the VS Code `servers` format and omits empty env', () => {
    const entry = buildServerEntry({}, true);
    expect(entry.type).toBe('stdio');
    expect(entry.env).toBeUndefined();
  });
});

describe('buildTomlBlock', () => {
  it('produces a valid Codex TOML table with an env subtable', () => {
    const toml = buildTomlBlock({ DATABASE_URL: 'postgres://x' });
    expect(toml).toContain('[mcp_servers.lurq]');
    expect(toml).toContain('command = "npx"');
    expect(toml).toContain('args = ["-y", "lurqrun", "serve"]');
    expect(toml).toContain('[mcp_servers.lurq.env]');
    expect(toml).toContain('DATABASE_URL = "postgres://x"');
  });

  it('omits the env subtable when there is no env', () => {
    expect(buildTomlBlock({})).not.toContain('env');
  });
});

describe('buildRemoteServerEntry (hosted)', () => {
  const opts = { url: 'https://api.lurq.run/mcp', apiKey: 'lurq_live_abc' };

  it('uses type:http + Bearer header for Claude Code and VS Code, never DATABASE_URL', () => {
    for (const id of ['claude-code', 'copilot']) {
      const entry = buildRemoteServerEntry(id, opts);
      expect(entry).toEqual({
        type: 'http',
        url: 'https://api.lurq.run/mcp',
        headers: { Authorization: 'Bearer lurq_live_abc' },
      });
      expect(JSON.stringify(entry)).not.toContain('DATABASE_URL');
      expect(entry.command).toBeUndefined();
    }
  });

  it('omits type for Cursor (transport inferred from url)', () => {
    expect(buildRemoteServerEntry('cursor', opts)).toEqual({
      url: 'https://api.lurq.run/mcp',
      headers: { Authorization: 'Bearer lurq_live_abc' },
    });
  });

  it('uses serverUrl for Windsurf and Antigravity', () => {
    for (const id of ['windsurf', 'antigravity']) {
      expect(buildRemoteServerEntry(id, opts)).toEqual({
        serverUrl: 'https://api.lurq.run/mcp',
        headers: { Authorization: 'Bearer lurq_live_abc' },
      });
    }
  });

  it('omits type for Kiro (transport inferred from url)', () => {
    expect(buildRemoteServerEntry('kiro', opts)).toEqual({
      url: 'https://api.lurq.run/mcp',
      headers: { Authorization: 'Bearer lurq_live_abc' },
    });
  });

  // A plain `url` is an SSE endpoint to the Gemini CLI, so the streamable-HTTP
  // handshake would never happen. This is the one field name we cannot share.
  it('uses httpUrl for the Gemini CLI, never a bare url', () => {
    const entry = buildRemoteServerEntry('gemini-cli', opts);
    expect(entry).toEqual({
      httpUrl: 'https://api.lurq.run/mcp',
      headers: { Authorization: 'Bearer lurq_live_abc' },
    });
    expect(entry.url).toBeUndefined();
  });
});

describe('agentSpecs', () => {
  it('covers every id in SUPPORTED_AGENTS, with no duplicate config paths', () => {
    const specs = agentSpecs();
    expect(specs.map((s) => s.id).sort()).toEqual([...SUPPORTED_AGENTS].sort());
    const paths = specs.map((s) => s.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('resolves every supported agent by id and rejects unknown ones', () => {
    for (const id of SUPPORTED_AGENTS) {
      expect(resolveAgents(id)[0]?.id).toBe(id);
    }
    expect(() => resolveAgents('zed')).toThrow(/Unknown agent/);
  });

  it('points each agent at the instructions file it actually auto-loads', () => {
    const byId = Object.fromEntries(agentSpecs().map((s) => [s.id, s]));

    // Claude Code reads personal skills from ~/.claude/skills/<name>/SKILL.md.
    expect(byId['claude-code']!.instructions).toMatchObject({ kind: 'skill' });
    expect(byId['claude-code']!.instructions!.path).toMatch(/\.claude\/skills\/lurq\/SKILL\.md$/);
    // Gemini's global context file, and Codex's user-level AGENTS.md, are files
    // the user also writes in, hence 'shared', which merges a marked block.
    expect(byId['gemini-cli']!.instructions).toMatchObject({ kind: 'shared' });
    expect(byId['gemini-cli']!.instructions!.path).toMatch(/\.gemini\/GEMINI\.md$/);
    expect(byId['codex']!.instructions!.path).toMatch(/\.codex\/AGENTS\.md$/);
    // Ours alone, in a directory the agent scans.
    expect(byId['kiro']!.instructions).toMatchObject({ kind: 'file' });
    expect(byId['kiro']!.instructions!.path).toMatch(/\.kiro\/steering\/lurq\.md$/);
    // Cursor's user rules live in its settings UI, not on disk. Writing a file
    // would report success for something nothing reads.
    expect(byId['cursor']!.instructions).toBeUndefined();
  });

  it('sends Antigravity to the same global GEMINI.md as the Gemini CLI', () => {
    const byId = Object.fromEntries(agentSpecs().map((s) => [s.id, s]));
    expect(byId['antigravity']!.instructions!.path).toBe(byId['gemini-cli']!.instructions!.path);
  });
});

describe('upsertMarkedBlock', () => {
  const user = '# My rules\n\nAlways use tabs.\n';

  it('appends a delimited block, keeping what the user already wrote', () => {
    const out = upsertMarkedBlock(user, 'use lurq');
    expect(out).toContain('Always use tabs.');
    expect(out).toContain('<!-- lurq:start -->\nuse lurq\n<!-- lurq:end -->');
  });

  it('is idempotent: a re-run replaces our block instead of stacking copies', () => {
    const once = upsertMarkedBlock(user, 'v1');
    const twice = upsertMarkedBlock(once, 'v2');
    expect(twice.match(/lurq:start/g)).toHaveLength(1);
    expect(twice).not.toContain('v1');
    expect(twice).toContain('v2');
    expect(twice).toContain('Always use tabs.');
    // Stable once the content stops changing, so setup can be run any number of times.
    expect(upsertMarkedBlock(twice, 'v2')).toBe(twice);
  });

  it('keeps the user text that follows our block', () => {
    const mixed = `${upsertMarkedBlock(user, 'v1')}\n# Later section\n\nkeep me\n`;
    const out = upsertMarkedBlock(mixed, 'v2');
    expect(out).toContain('Always use tabs.');
    expect(out).toContain('keep me');
    expect(out).toContain('v2');
  });

  it('recovers from a hand-edited file whose end marker was deleted', () => {
    const broken = `${user}\n<!-- lurq:start -->\nhalf a block`;
    const out = upsertMarkedBlock(broken, 'v2');
    expect(out.match(/lurq:start/g)).toHaveLength(1);
    expect(out).toContain('<!-- lurq:end -->');
    expect(out).toContain('Always use tabs.');
  });

  it('writes a clean file when there was nothing there before', () => {
    expect(upsertMarkedBlock('', 'only us')).toBe(
      '<!-- lurq:start -->\nonly us\n<!-- lurq:end -->\n',
    );
  });
});

describe('buildSkillFile', () => {
  it('emits YAML frontmatter with a name and a trigger description, then the guide', () => {
    const out = buildSkillFile('# guide\n\nbody text');
    const [, frontmatter, body] = out.split('---\n');
    expect(frontmatter).toContain('name: lurq');
    // The description is the only part Claude Code loads every turn, so it has
    // to say when to reach for lurq without the body being read.
    expect(frontmatter).toMatch(/description: .*npm/);
    expect(frontmatter!.split('\n').filter((l) => l.startsWith('description:'))).toHaveLength(1);
    expect(body).toContain('body text');
  });
});

describe('installInstructions', () => {
  const spec = (kind: 'skill' | 'file' | 'shared', path: string): AgentSpec => ({
    id: 'test',
    label: 'Test',
    format: 'mcpServers',
    path: join(path, 'mcp.json'),
    detected: true,
    instructions: { kind, path: join(path, kind === 'skill' ? 'SKILL.md' : 'rules.md') },
  });

  it('creates missing parent directories and writes the full guide', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'lurq-instr-')), 'nested', 'deeper');
    const written = installInstructions(spec('file', dir));
    expect(written).toBeTruthy();
    expect(readFileSync(written!, 'utf8')).toContain('Call lurq when you are about to');
  });

  it('merges into a shared context file instead of overwriting the user rules', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lurq-instr-'));
    const target = join(dir, 'rules.md');
    writeFileSync(target, '# My global rules\n\nPrefer pnpm.\n');

    installInstructions(spec('shared', dir));
    const first = readFileSync(target, 'utf8');
    expect(first).toContain('Prefer pnpm.');
    expect(first).toContain('lurq:start');

    installInstructions(spec('shared', dir));
    const second = readFileSync(target, 'utf8');
    expect(second.match(/lurq:start/g)).toHaveLength(1);
    expect(second).toContain('Prefer pnpm.');
  });

  it('writes frontmatter only for the skill kind', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lurq-instr-'));
    const skill = readFileSync(installInstructions(spec('skill', dir))!, 'utf8');
    expect(skill.startsWith('---\n')).toBe(true);

    const plain = readFileSync(installInstructions(spec('file', dir))!, 'utf8');
    expect(plain.startsWith('---\n')).toBe(false);
  });

  it('returns null for an agent with nowhere to put instructions', () => {
    const cursor = agentSpecs().find((s) => s.id === 'cursor')!;
    expect(installInstructions(cursor)).toBeNull();
  });
});

describe('buildRemoteTomlBlock (hosted)', () => {
  it('emits url + an inline http_headers table (Codex deny_unknown_fields), no command/env', () => {
    const toml = buildRemoteTomlBlock({ url: 'https://api.lurq.run/mcp', apiKey: 'lurq_live_abc' });
    expect(toml).toContain('[mcp_servers.lurq]');
    expect(toml).toContain('url = "https://api.lurq.run/mcp"');
    // Codex expects an inline `http_headers` table, NOT a `[...headers]` subtable.
    expect(toml).toContain('http_headers = { Authorization = "Bearer lurq_live_abc" }');
    expect(toml).not.toContain('[mcp_servers.lurq.headers]');
    expect(toml).not.toContain('command');
    expect(toml).not.toContain('DATABASE_URL');
  });
});

describe('stripTomlBlock', () => {
  const config = [
    'model = "gpt-5"',
    '',
    '[mcp_servers.other]',
    'command = "x"',
    '',
    '[mcp_servers.lurq]',
    'url = "https://api.lurq.run/mcp"',
    'http_headers = { Authorization = "Bearer old" }',
    '',
    '[mcp_servers.lurq.env]',
    'FOO = "1"',
    '',
    '[profiles.dev]',
    'approval = "never"',
    '',
  ].join('\n');

  // Re-running `lurq install` after a key rotation must replace the entry, not
  // skip it and leave Codex on the dead key.
  it('removes the lurq table and its sub-tables, keeping siblings', () => {
    const out = stripTomlBlock(config);
    expect(out).not.toContain('[mcp_servers.lurq]');
    expect(out).not.toContain('Bearer old');
    expect(out).not.toContain('[mcp_servers.lurq.env]');
    expect(out).toContain('[mcp_servers.other]');
    expect(out).toContain('[profiles.dev]');
    expect(out).toContain('model = "gpt-5"');
  });

  it('leaves a config with no lurq entry untouched', () => {
    expect(stripTomlBlock('model = "gpt-5"\n')).toBe('model = "gpt-5"\n');
  });
});
