import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { PACKAGE_NAME, VERSION } from '../src/core/constants';

/**
 * `VERSION` / `PACKAGE_NAME` are hand-synced with package.json (they must be
 * bundle-time constants — the published CLI reports them via `lurq -v` and the
 * MCP server handshake). A publish that bumps package.json and forgets these
 * ships an assistant that misreports which lurq it is. Cheaper to fail here.
 */
describe('constants stay in sync with package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    name: string;
    version: string;
  };

  it('VERSION matches package.json version', () => {
    expect(VERSION).toBe(pkg.version);
  });

  it('PACKAGE_NAME matches package.json name', () => {
    expect(PACKAGE_NAME).toBe(pkg.name);
  });
});
