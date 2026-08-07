import { describe, it, expect } from 'vitest';
import {
  buildServerEntry,
  buildTomlBlock,
  buildRemoteServerEntry,
  buildRemoteTomlBlock,
  stripTomlBlock,
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

  it('uses serverUrl for Windsurf', () => {
    expect(buildRemoteServerEntry('windsurf', opts)).toEqual({
      serverUrl: 'https://api.lurq.run/mcp',
      headers: { Authorization: 'Bearer lurq_live_abc' },
    });
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
