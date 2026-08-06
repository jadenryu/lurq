import { describe, it, expect, vi, beforeEach } from 'vitest';

// The `usage` action lazily imports its handler; stub it so parsing is observable
// without touching the DB.
vi.mock('../src/cli/commands', () => ({ runUsage: vi.fn() }));

import { buildProgram } from '../src/cli/index';
import * as commands from '../src/cli/commands';
import { VERSION } from '../src/core/constants';

const runUsage = vi.mocked(commands.runUsage);

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
