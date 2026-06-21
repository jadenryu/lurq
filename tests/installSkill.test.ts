import { describe, it, expect } from 'vitest';
import { buildServerEntry, buildTomlBlock } from '../src/cli/installSkill';

describe('buildServerEntry', () => {
  it('builds the standard npx stdio entry with env', () => {
    expect(buildServerEntry({ DATABASE_URL: 'postgres://x' }, false)).toEqual({
      command: 'npx',
      args: ['-y', 'lurq', 'serve'],
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
    expect(toml).toContain('args = ["-y", "lurq", "serve"]');
    expect(toml).toContain('[mcp_servers.lurq.env]');
    expect(toml).toContain('DATABASE_URL = "postgres://x"');
  });

  it('omits the env subtable when there is no env', () => {
    expect(buildTomlBlock({})).not.toContain('env');
  });
});
