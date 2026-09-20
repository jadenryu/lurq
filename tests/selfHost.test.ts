import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SELF_HOST_DEPENDENCIES, selfHostHint } from '../src/core/selfHost';

const notFound = (pkg: string) =>
  Object.assign(new Error(`Cannot find package '${pkg}' imported from /x/dist/chunk-A.js`), {
    code: 'ERR_MODULE_NOT_FOUND',
  });

describe('selfHostHint', () => {
  it('names every self-host dependency with its range when one is missing', () => {
    const hint = selfHostHint(notFound('postgres'));
    expect(hint).toContain('"postgres" is missing');
    for (const name of SELF_HOST_DEPENDENCIES) expect(hint).toContain(` ${name}@`);
  });

  it('leaves unrelated errors alone', () => {
    expect(selfHostHint(notFound('left-pad'))).toBeNull();
    expect(selfHostHint(new Error("Cannot find package 'postgres'"))).toBeNull();
  });
});

describe('scripts/publish-manifest.mjs', () => {
  it('leaves self-host and inlined deps out of the packed manifest, and restores it byte for byte', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lurq-manifest-'));
    const root = join(import.meta.dirname, '..');
    cpSync(join(root, 'package.json'), join(dir, 'package.json'));
    const original = readFileSync(join(dir, 'package.json'), 'utf8');
    const script = join(root, 'scripts', 'publish-manifest.mjs');

    execFileSync('node', [script, 'strip'], { cwd: dir });
    const stripped = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const pkg = JSON.parse(original);
    for (const name of [...SELF_HOST_DEPENDENCIES, ...pkg.lurq.inlinedDependencies]) {
      expect(stripped.dependencies[name]).toBeUndefined();
    }
    // Optional peers would still cost a registry round trip each at install.
    expect(stripped.peerDependencies).toBeUndefined();
    // What the bundle leaves external stays a real dependency.
    expect(stripped.dependencies.typescript).toBeTruthy();
    // A second strip before restore would back up the stripped copy.
    expect(() => execFileSync('node', [script, 'strip'], { cwd: dir, stdio: 'pipe' })).toThrow();

    execFileSync('node', [script, 'restore'], { cwd: dir });
    expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe(original);
  });
});
