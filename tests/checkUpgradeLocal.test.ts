/**
 * `checkUpgrade` end to end, against real tarballs served from memory.
 *
 * Each scenario is an upgrade that once produced the wrong verdict. The unit
 * tests pin the pieces; these pin the verdict a CI gate actually acts on, which
 * is the thing that loses its credibility in one incident.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { scanReferences } from '../src/surface/references';
import { checkUpgrade, type UpgradeReport } from '../src/surface/upgrade';

const registry = new Map<string, { json?: unknown; tgz?: Buffer }>();
const dirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function write(root: string, files: Record<string, string>): void {
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), body);
  }
}

/** Publish `name@version` to the in-memory registry. `manifest` is its package.json. */
function publish(
  name: string,
  version: string,
  manifest: object,
  files: Record<string, string>,
): void {
  const dir = tempDir('lurq-pkg-');
  const full = { name, version, ...manifest };
  write(join(dir, 'package'), { 'package.json': JSON.stringify(full), ...files });
  execFileSync('tar', ['czf', join(dir, 'p.tgz'), '-C', dir, 'package']);
  const tgz = readFileSync(join(dir, 'p.tgz'));
  const tarball = `https://tarballs.test/${name}-${version}.tgz`;
  const integrity = `sha512-${createHash('sha512').update(tgz).digest('base64')}`;
  registry.set(`https://registry.npmjs.org/${name}/${version}`, {
    json: { ...full, dist: { tarball, integrity } },
  });
  registry.set(tarball, { tgz });
}

function project(files: Record<string, string>): string {
  const dir = tempDir('lurq-project-');
  write(dir, files);
  return dir;
}

async function check(
  root: string,
  pkg: string,
  fromVersion: string,
  toVersion: string,
): Promise<UpgradeReport> {
  return checkUpgrade([{ package: pkg, fromVersion, toVersion }], scanReferences(root), {
    rootDir: root,
  });
}

beforeAll(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    const hit = registry.get(String(url));
    if (!hit) return new Response('not found', { status: 404 });
    return hit.json ? new Response(JSON.stringify(hit.json)) : new Response(hit.tgz);
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe('verdicts a CI gate acts on', () => {
  // A build moved from tsc to esbuild: same API, every export now behind a getter.
  it('reads through bundler export getters instead of reporting every parameter gone', async () => {
    publish(
      'lib',
      '1.0.0',
      { main: 'index.js' },
      {
        'index.js': `"use strict";\nexports.parse = void 0;\nfunction parse(str, opts) { return str; }\nexports.parse = parse;\n`,
      },
    );
    publish(
      'lib',
      '1.1.0',
      { main: 'index.js' },
      {
        'index.js': [
          `"use strict";`,
          `var __defProp = Object.defineProperty;`,
          `var __export = (target, all) => { for (var name in all) __defProp(target, name, { get: all[name], enumerable: true }); };`,
          `var src_exports = {};`,
          `__export(src_exports, {\n  parse: () => parse\n});`,
          `module.exports = src_exports;`,
          `function parse(str, opts) { return str; }`,
        ].join('\n'),
      },
    );
    const report = await check(
      project({ 'a.js': `import { parse } from 'lib';\nparse('x', {});\n` }),
      'lib',
      '1.0.0',
      '1.1.0',
    );
    expect(report).toMatchObject({ safe: true, breaking: [], ok: ['lib'] });
  });

  // `export * from 'core'` may well still provide `thing`; tier A cannot look.
  it('does not block on a name a wholesale re-export may still provide', async () => {
    publish(
      'wrap',
      '1.0.0',
      { main: 'index.js' },
      {
        'index.js': `var core = require('core');\nexports.thing = core.thing;\nexports.local = function local(a) {};\n`,
      },
    );
    publish(
      'wrap',
      '2.0.0',
      { type: 'module', exports: './index.js' },
      {
        'index.js': `export * from 'core';\nexport function local(a) {}\n`,
      },
    );
    const root = project({
      'package.json': JSON.stringify({ engines: { node: '>=22.12' } }),
      'b.cjs': `const { thing, local } = require('wrap');\nlocal(thing);\n`,
    });
    const report = await check(root, 'wrap', '1.0.0', '2.0.0');
    expect(report.breaking.filter((b) => b.severity === 'blocking')).toEqual([]);
    expect(report.unverified.map((u) => u.package)).toEqual(['wrap']);
    expect(report.safe).toBe(false);
  });

  it('follows a deep import that moved into a directory with its own package.json', async () => {
    publish(
      'deep',
      '1.0.0',
      { main: 'index.js' },
      { 'index.js': 'exports.x = 1;', 'sub.js': 'exports.a = function a() {};' },
    );
    publish(
      'deep',
      '1.1.0',
      { main: 'index.js' },
      {
        'index.js': 'exports.x = 1;',
        'sub/package.json': JSON.stringify({ main: '../dist/sub.js' }),
        'dist/sub.js': 'exports.a = function a() {};',
      },
    );
    const report = await check(
      project({ 'c.js': `const { a } = require('deep/sub');\na();\n` }),
      'deep',
      '1.0.0',
      '1.1.0',
    );
    expect(report).toMatchObject({ safe: true, breaking: [], ok: ['deep'] });
  });

  it('blocks a withdrawn entry loaded only for its side effects, and names the Node it needs', async () => {
    publish(
      'reg',
      '1.0.0',
      { main: 'index.js' },
      { 'index.js': 'exports.x = 1;', 'register.js': 'require("./index")' },
    );
    publish(
      'reg',
      '2.0.0',
      { exports: { '.': './index.js' }, type: 'module', engines: { node: '>=24' } },
      {
        'index.js': 'export const x = 1;',
      },
    );
    const root = project({
      'package.json': JSON.stringify({ engines: { node: '>=18' } }),
      'd.js': `require('reg/register');\n`,
    });
    const [finding] = (await check(root, 'reg', '1.0.0', '2.0.0')).breaking;
    expect(finding).toMatchObject({
      severity: 'blocking',
      entriesRemoved: [{ specifier: 'reg/register' }],
      requirements: [{ kind: 'engines', name: 'node', needs: '>=24' }],
    });
  });

  // `class Bus extends Emitter` evaluates Emitter when the module loads.
  it('blocks the removal of a base class the code extends', async () => {
    publish(
      'base',
      '1.0.0',
      { main: 'index.js' },
      { 'index.js': 'exports.Emitter = class Emitter {}; exports.other = 1;' },
    );
    publish('base', '2.0.0', { main: 'index.js' }, { 'index.js': 'exports.other = 1;' });
    const root = project({
      'e.js': `import { Emitter } from 'base';\nexport class Bus extends Emitter {}\n`,
    });
    const [finding] = (await check(root, 'base', '1.0.0', '2.0.0')).breaking;
    expect(finding).toMatchObject({
      severity: 'blocking',
      symbolsRemoved: [{ symbol: 'Emitter' }],
    });
  });

  // A JSX attribute named `render` is not a use of the imported `render`.
  it('does not count a same-named JSX attribute as an unmeasurable use', async () => {
    publish(
      'ui',
      '1.0.0',
      { main: 'index.js' },
      { 'index.js': 'exports.render = function render(a) {};' },
    );
    publish(
      'ui',
      '2.0.0',
      { main: 'index.js' },
      { 'index.js': 'exports.render = function render(a, b) {};' },
    );
    const root = project({
      'g.jsx': `import { render } from 'ui';\nrender(1, 2);\nexport const el = <Route render={() => null} />;\n`,
    });
    expect(await check(root, 'ui', '1.0.0', '2.0.0')).toMatchObject({ safe: true, breaking: [] });
  });

  // A CLI or build tool nobody imports can still need a Node the project does not run.
  it('checks Node and peer requirements for a package the code never imports', async () => {
    publish('tool', '1.0.0', { main: 'index.js', engines: { node: '>=14' } }, { 'index.js': '' });
    publish('tool', '2.0.0', { main: 'index.js', engines: { node: '>=24' } }, { 'index.js': '' });
    const root = project({
      'package.json': JSON.stringify({ engines: { node: '>=18' } }),
      'x.js': '',
    });
    const [finding] = (await check(root, 'tool', '1.0.0', '2.0.0')).breaking;
    expect(finding).toMatchObject({
      severity: 'warning',
      requirements: [{ name: 'node', needs: '>=24' }],
    });
  });

  // A parameter that shadows the binding is a different variable.
  it('never blocks on a call of a shadowed name', async () => {
    publish(
      'paint',
      '1.0.0',
      { main: 'index.js' },
      { 'index.js': 'module.exports = function paint(s) { return s; };' },
    );
    publish(
      'paint',
      '2.0.0',
      { type: 'module', exports: './index.js' },
      { 'index.js': 'export default function paint(s) { return s; }' },
    );
    const root = project({
      'package.json': JSON.stringify({ engines: { node: '>=22.12' } }),
      'p.js': `const paint = require('paint');\nfunction apply(paint) { return paint('x'); }\nmodule.exports = apply(paint.default);\n`,
    });
    const report = await check(root, 'paint', '1.0.0', '2.0.0');
    expect(report.breaking.filter((b) => b.severity === 'blocking')).toEqual([]);
  });
});
