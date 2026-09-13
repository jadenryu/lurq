/**
 * Setup's failure modes before it writes anything: no terminal to prompt in, a
 * key the server rejects, and a typo'd command that used to look like success.
 */
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProgram } from '../src/cli/index';
import { runSetup } from '../src/cli/install';
import { readUserConfig } from '../src/core/userConfig';

describe('setup guards', () => {
  let home: string;
  const savedHome = process.env.HOME;
  const savedLurqHome = process.env.LURQ_HOME;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'lurq-guard-home-'));
    process.env.HOME = home;
    process.env.LURQ_HOME = join(home, '.lurq');
    // A detected agent, so a wrongly-accepted key would have somewhere to land.
    mkdirSync(join(home, '.cursor'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    process.env.HOME = savedHome;
    process.env.LURQ_HOME = savedLurqHome;
  });

  it('refuses to prompt without a terminal, and says how to run non-interactively', async () => {
    // vitest's stdin is not a TTY, exactly like CI or `npx lurqrun </dev/null`.
    await expect(runSetup({})).rejects.toThrow(/setup --yes --api-key <key>[\s\S]*dashboard\/keys/);
    expect(readUserConfig().apiKey).toBeUndefined();
  });

  it('--yes validates the key with an authenticated call and writes nothing when it is rejected', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      runSetup({ yes: true, apiKey: 'lurq_bogus', url: 'http://127.0.0.1:9/mcp' }),
    ).rejects.toThrow(/rejected that API key.*Nothing was written/);

    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer lurq_bogus');
    expect(readUserConfig().apiKey).toBeUndefined();
    expect(existsSync(join(home, '.cursor', 'mcp.json'))).toBe(false);
  });

  it('--yes fails clearly when the endpoint cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))));
    await expect(
      runSetup({ yes: true, apiKey: 'lurq_live_x', url: 'http://127.0.0.1:9/mcp' }),
    ).rejects.toThrow(/Could not reach/);
    expect(readUserConfig().apiKey).toBeUndefined();
  });
});

describe('unknown commands', () => {
  const quiet = () =>
    buildProgram()
      .exitOverride()
      .configureOutput({ writeErr: () => {}, writeOut: () => {} });

  it('rejects a typo with a suggestion instead of running setup or printing help', async () => {
    await expect(quiet().parseAsync(['node', 'lurq', 'evalute', 'zod'])).rejects.toMatchObject({
      code: 'commander.unknownCommand',
      message: expect.stringContaining('evaluate'),
    });
  });
});
