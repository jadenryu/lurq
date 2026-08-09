import { describe, it, expect, vi, beforeEach } from 'vitest';

// The `usage` action lazily imports its handler; stub it so parsing is observable
// without touching the DB. Same for `setup`, which would otherwise open a
// browser and prompt.
vi.mock('../src/cli/commands', () => ({ runUsage: vi.fn() }));
vi.mock('../src/cli/install', () => ({ runSetup: vi.fn() }));

import { buildProgram } from '../src/cli/index';
import * as commands from '../src/cli/commands';
import * as install from '../src/cli/install';
import { VERSION } from '../src/core/constants';

const runUsage = vi.mocked(commands.runUsage);
const runSetup = vi.mocked(install.runSetup);

/** Parse an argv as a user would type it (no node/script prefix). */
function run(argv: string[]): Promise<unknown> {
  return buildProgram().parseAsync(argv, { from: 'user' });
}

describe('usage target version (§13)', () => {
  beforeEach(() => runUsage.mockReset());

  it('passes --target through to runUsage', async () => {
    await run(['usage', 'puppeteer', '--target', '24.14.0', '--known', '21.11.0']);
    expect(runUsage).toHaveBeenCalledWith('puppeteer', {
      version: '24.14.0',
      known: '21.11.0',
      json: undefined,
    });
  });

  // Regression: the program-level `-v, --version` used to swallow this, printing
  // the lurq version and exiting before the command ever ran.
  it('still accepts --version after the subcommand as an alias for --target', async () => {
    await run(['usage', 'puppeteer', '--version', '24.14.0', '--known', '21.11.0']);
    expect(runUsage).toHaveBeenCalledWith('puppeteer', {
      version: '24.14.0',
      known: '21.11.0',
      json: undefined,
    });
  });

  it('leaves the version unset when no target is given', async () => {
    await run(['usage', 'puppeteer', '--json']);
    expect(runUsage).toHaveBeenCalledWith('puppeteer', {
      version: undefined,
      known: undefined,
      json: true,
    });
  });

  it('advertises --target and hides the --version alias in help', () => {
    const usage = buildProgram().commands.find((c) => c.name() === 'usage');
    const help = usage?.helpInformation() ?? '';
    expect(help).toContain('--target <v>');
    expect(help).not.toContain('--version');
  });

  it('keeps the program-level version flag working before a subcommand', async () => {
    const out: string[] = [];
    const program = buildProgram()
      .exitOverride()
      .configureOutput({ writeOut: (s) => out.push(s) });

    await expect(program.parseAsync(['--version'], { from: 'user' })).rejects.toMatchObject({
      code: 'commander.version',
    });
    expect(out.join('')).toContain(VERSION);
    expect(runUsage).not.toHaveBeenCalled();
  });
});

describe('setup', () => {
  beforeEach(() => runSetup.mockReset());

  // `npx lurqrun install` is in published docs, dashboard copy and people's
  // notes. Renaming the command to `setup` must not break any of them.
  it('keeps `install` and `login` working as aliases', async () => {
    for (const name of ['setup', 'install', 'login']) {
      runSetup.mockReset();
      await run([name, '--api-key', 'lurq_live_abc', '--yes']);
      expect(runSetup).toHaveBeenCalledTimes(1);
      expect(runSetup.mock.calls[0]![0]).toMatchObject({ apiKey: 'lurq_live_abc', yes: true });
    }
  });

  it('defaults to opening a browser, and honours --no-open for headless boxes', async () => {
    await run(['setup', '--yes']);
    expect(runSetup.mock.calls[0]![0]).toMatchObject({ noOpen: false });

    runSetup.mockReset();
    await run(['setup', '--yes', '--no-open']);
    expect(runSetup.mock.calls[0]![0]).toMatchObject({ noOpen: true });
  });

  it('advertises setup, not install, in the top-level help', () => {
    const help = buildProgram().helpInformation();
    expect(help).toContain('setup');
    expect(help).toContain('store your API key');
  });
});
