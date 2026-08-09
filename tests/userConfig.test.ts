/**
 * The stored credential file. It holds a live API key, so the permission bits
 * and the precedence rules are the parts worth pinning down.
 */
import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearUserConfig,
  readUserConfig,
  resolveApiKey,
  resolveEndpoint,
  userConfigPath,
  writeUserConfig,
} from '../src/core/userConfig';

const savedKey = process.env.LURQ_API_KEY;
const savedEndpoint = process.env.LURQ_ENDPOINT;

beforeEach(() => {
  // A throwaway home per test, so nothing here can read or clobber the real key.
  process.env.LURQ_HOME = mkdtempSync(join(tmpdir(), 'lurq-cfg-'));
  delete process.env.LURQ_API_KEY;
  delete process.env.LURQ_ENDPOINT;
});

afterEach(() => {
  if (savedKey) process.env.LURQ_API_KEY = savedKey;
  if (savedEndpoint) process.env.LURQ_ENDPOINT = savedEndpoint;
});

describe('writeUserConfig', () => {
  it('round-trips the key and is readable only by its owner', () => {
    const path = writeUserConfig({ apiKey: 'lurq_live_abc' });
    expect(readUserConfig().apiKey).toBe('lurq_live_abc');
    // 0600. A world-readable file in $HOME is how a shared box leaks a key.
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('merges rather than replacing, so setting one field keeps the other', () => {
    writeUserConfig({ apiKey: 'lurq_live_abc', endpoint: 'https://self.hosted/mcp' });
    writeUserConfig({ apiKey: 'lurq_live_rotated' });
    expect(readUserConfig()).toEqual({
      apiKey: 'lurq_live_rotated',
      endpoint: 'https://self.hosted/mcp',
    });
  });

  it('reads as unconfigured when the file is absent, empty, or corrupt', () => {
    expect(readUserConfig()).toEqual({});
    writeFileSync(userConfigPath(), 'not json at all');
    // A hand-mangled config should mean "no key", not a crash on every command.
    expect(readUserConfig()).toEqual({});
  });

  it('clears the stored key and reports whether there was one', () => {
    expect(clearUserConfig()).toBe(false);
    writeUserConfig({ apiKey: 'lurq_live_abc' });
    expect(clearUserConfig()).toBe(true);
    expect(readUserConfig().apiKey).toBeUndefined();
  });
});

describe('resolveApiKey', () => {
  it('prefers an explicit flag, then the environment, then the stored file', () => {
    writeUserConfig({ apiKey: 'stored' });
    expect(resolveApiKey()).toBe('stored');

    // CI sets LURQ_API_KEY as a secret; it must win over a developer's saved key
    // rather than being silently ignored.
    process.env.LURQ_API_KEY = 'from-env';
    expect(resolveApiKey()).toBe('from-env');
    expect(resolveApiKey('from-flag')).toBe('from-flag');
  });

  it('ignores blank values instead of treating them as a configured key', () => {
    writeUserConfig({ apiKey: 'stored' });
    process.env.LURQ_API_KEY = '   ';
    expect(resolveApiKey('')).toBe('stored');
  });

  it('returns undefined on a machine that has never been set up', () => {
    expect(resolveApiKey()).toBeUndefined();
    expect(resolveEndpoint()).toBeUndefined();
  });
});
