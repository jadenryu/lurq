/**
 * Setup from an agent's shell with no key: it prints the sign-in link and the
 * restart instruction, and returns without writing anything itself.
 */
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/cli/agentLink', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/cli/agentLink')>()),
  startAgentLink: vi.fn(async () => 'https://lurq.run/dashboard/cli?port=4567&nonce=abc'),
}));

import { startAgentLink } from '../src/cli/agentLink';
import { runSetup } from '../src/cli/install';
import { readUserConfig } from '../src/core/userConfig';

describe('setup from an agent shell', () => {
  const saved = { home: process.env.HOME, lurqHome: process.env.LURQ_HOME, ci: process.env.CI, key: process.env.LURQ_API_KEY };
  let out: string[];

  beforeEach(() => {
    const home = mkdtempSync(join(tmpdir(), 'lurq-link-home-'));
    process.env.HOME = home;
    process.env.LURQ_HOME = join(home, '.lurq');
    // This test is the non-CI path, whatever machine runs it.
    delete process.env.CI;
    delete process.env.LURQ_API_KEY;
    mkdirSync(join(home, '.cursor'));
    out = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void out.push(args.join(' ')));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const [env, value] of [
      ['HOME', saved.home],
      ['LURQ_HOME', saved.lurqHome],
      ['CI', saved.ci],
      ['LURQ_API_KEY', saved.key],
    ] as const) {
      if (value === undefined) delete process.env[env];
      else process.env[env] = value;
    }
  });

  it('prints the link, what signing in will connect, and to restart the agent', async () => {
    await runSetup({});
    const text = out.join('\n');
    expect(startAgentLink).toHaveBeenCalled();
    expect(text).toContain('https://lurq.run/dashboard/cli?port=4567&nonce=abc');
    expect(text).toContain('Cursor');
    expect(text).toMatch(/restart your coding agent/i);
    // The detached copy stores the key after sign-in; this command writes nothing.
    expect(readUserConfig().apiKey).toBeUndefined();
  });
});
