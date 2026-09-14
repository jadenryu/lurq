/**
 * Automatic hook upkeep: installs for agents set up with lurq, respects removals,
 * refreshes a moved binary, runs once a day, and can be turned off.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { maintainHooks, planHookMaintenance } from '../src/cli/autoHooks';
import { hasLurqHooks, hooksPath, installHooks } from '../src/cli/installSkill';
import { readUserConfig, writeUserConfig } from '../src/core/userConfig';

const DAY = 24 * 60 * 60 * 1000;

describe('planHookMaintenance', () => {
  const base = { agent: 'cursor' as const, hasEntry: true, hooksPresent: false, current: '/bin/lurq' };

  it('installs for a set-up agent lurq never hooked, and nothing without the MCP entry', () => {
    expect(planHookMaintenance([base])).toEqual([{ agent: 'cursor', kind: 'install' }]);
    expect(planHookMaintenance([{ ...base, hasEntry: false }])).toEqual([]);
  });

  it('leaves hooks the user removed, and refreshes a command that moved', () => {
    expect(planHookMaintenance([{ ...base, recorded: '/bin/lurq' }])).toEqual([]);
    expect(planHookMaintenance([{ ...base, hooksPresent: true, recorded: '/old/lurq' }])).toEqual([{ agent: 'cursor', kind: 'refresh' }]);
    expect(planHookMaintenance([{ ...base, hooksPresent: true, recorded: '/bin/lurq' }])).toEqual([]);
  });
});

describe('maintainHooks', () => {
  // Restored key by key: replacing process.env detaches it from the real environment, and os.homedir() stops seeing HOME.
  const KEYS = ['HOME', 'LURQ_HOME', 'XDG_CACHE_HOME', 'PATH', 'LURQ_NO_AUTO_HOOKS', 'LURQ_API_KEY'] as const;
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  let home: string;
  let bin: string;
  const put = (path: string, text: string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };
  const cursorCommand = () => JSON.parse(readFileSync(hooksPath('cursor'), 'utf8')).hooks.sessionStart[0].command;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'lurq-autohooks-'));
    process.env.HOME = home;
    process.env.LURQ_HOME = join(home, '.lurq');
    process.env.XDG_CACHE_HOME = join(home, '.cache');
    delete process.env.LURQ_NO_AUTO_HOOKS;
    delete process.env.LURQ_API_KEY;
    const binDir = join(home, 'bin');
    bin = join(binDir, 'lurq');
    put(bin, '#!/bin/sh\n');
    chmodSync(bin, 0o755);
    process.env.PATH = binDir;
    writeUserConfig({ apiKey: 'lurq_live_x' });
    put(join(home, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { lurq: { type: 'http' } } }));
    put(join(home, '.claude.json'), JSON.stringify({ mcpServers: {} }));
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('hooks up agents that have lurq, and only those', async () => {
    await maintainHooks(['verify', 'zod']);
    expect(cursorCommand()).toBe(`${bin} hook --agent cursor session-start`);
    expect(readUserConfig().hooks?.cursor?.command).toBe(bin);
    expect(existsSync(hooksPath('claude'))).toBe(false);
  });

  it('runs once a day, keeps a removal, and follows a moved binary', async () => {
    await maintainHooks(['verify']);
    writeFileSync(hooksPath('cursor'), JSON.stringify({ version: 1 }));
    await maintainHooks(['verify'], Date.now() + 2 * DAY);
    expect(hasLurqHooks(JSON.parse(readFileSync(hooksPath('cursor'), 'utf8')))).toBe(false);

    installHooks('cursor', undefined, { command: 'lurq', onPath: true, path: '/old/lurq' });
    await maintainHooks(['verify']);
    expect(cursorCommand()).toContain('/old/lurq'); // Checked less than a day ago.
    await maintainHooks(['verify'], Date.now() + 4 * DAY);
    expect(cursorCommand()).toBe(`${bin} hook --agent cursor session-start`);
  });

  it('does nothing when turned off, during setup, or without a key', async () => {
    process.env.LURQ_NO_AUTO_HOOKS = '1';
    await maintainHooks(['verify']);
    delete process.env.LURQ_NO_AUTO_HOOKS;
    await maintainHooks(['setup']);
    expect(existsSync(hooksPath('cursor'))).toBe(false);
    writeUserConfig({ autoHooks: false });
    await maintainHooks(['verify']);
    expect(existsSync(hooksPath('cursor'))).toBe(false);
  });
});
