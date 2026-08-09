/**
 * The global install is an interactive-only step.
 *
 * `npx lurqrun setup --yes` is what a CI job, a dotfiles bootstrap, or a
 * provisioning script runs. Those must come out the other side with a stored
 * key and nothing else: shelling out to `npm install --global` on a build agent
 * is a side effect nobody asked for, and it is the kind of regression that only
 * shows up as a mysteriously slow pipeline. The prompt lives inside the
 * interactive branch; this is the guard that keeps it there.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnSync = vi.fn(() => ({ status: 0, stderr: '', error: undefined }));
vi.mock('node:child_process', () => ({ spawnSync: (...args: unknown[]) => spawnSync(...(args as [])) }));

import { runningFromNpx, runSetup } from '../src/cli/install';
import { readUserConfig } from '../src/core/userConfig';

describe('setup --yes', () => {
  const savedHome = process.env.HOME;

  beforeEach(() => {
    spawnSync.mockClear();
    // A throwaway HOME so agent detection finds nothing real to write to.
    process.env.HOME = mkdtempSync(join(tmpdir(), 'lurq-yes-home-'));
    process.env.LURQ_HOME = mkdtempSync(join(tmpdir(), 'lurq-yes-cfg-'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (savedHome) process.env.HOME = savedHome;
    delete process.env.LURQ_HOME;
  });

  it('stores the key without ever shelling out to npm', async () => {
    await runSetup({ yes: true, apiKey: 'lurq_live_ci' });

    expect(spawnSync).not.toHaveBeenCalled();
    expect(readUserConfig().apiKey).toBe('lurq_live_ci');
  });

  it('detects the npx cache by path, not by guesswork', () => {
    expect(runningFromNpx('file:///Users/x/.npm/_npx/9c1/node_modules/lurqrun/dist/bin/lurq.js')).toBe(true);
    expect(runningFromNpx('file:///opt/homebrew/lib/node_modules/lurqrun/dist/bin/lurq.js')).toBe(false);
  });
});
