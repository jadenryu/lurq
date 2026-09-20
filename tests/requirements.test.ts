import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanReferences, type SymbolReference } from '../src/surface/references';
import { judgeRequirements, judgeRequires } from '../src/surface/requirements';

const ref = (over: Partial<SymbolReference>): SymbolReference => ({
  symbol: 'default',
  via: 'default',
  specifier: 'chalk',
  file: 'src/log.js',
  line: 1,
  loader: 'require',
  ...over,
});

const exportsOf = (...names: string[]) => new Set(names);

describe('require() across a switch to ESM', () => {
  // `const fetch = require('node-fetch'); fetch(url)` on node-fetch 3.
  it('blocks a direct call of what require returned, on every Node', () => {
    const judged = judgeRequires(
      'cjs',
      'esm',
      [
        ref({
          calls: [
            { line: 4, args: 1 },
            { line: 5, args: null },
          ],
        }),
      ],
      {
        fromExports: exportsOf('default'),
        toExports: exportsOf('default'),
        runtime: {},
      },
    );
    expect(judged!.broken).toEqual([
      {
        file: 'src/log.js',
        line: 4,
        why: 'require() now returns the module namespace, which cannot be called',
      },
    ]);
    expect(judged!.olderNode).toEqual([{ file: 'src/log.js', line: 1 }]);
  });

  // `chalk.red` was a property of chalk 4's exported value; chalk 5 has no `red` export.
  it('blocks a property the ES module does not export', () => {
    const judged = judgeRequires(
      'cjs',
      'esm',
      [
        ref({}),
        ref({ symbol: 'red', via: 'namespace', line: 3 }),
        ref({ symbol: 'chalkStderr', via: 'namespace', line: 6 }),
      ],
      {
        fromExports: exportsOf('default'),
        toExports: exportsOf('default', 'chalkStderr'),
        runtime: {},
      },
    );
    expect(judged!.broken.map((b) => b.line)).toEqual([3]);
  });

  // A name the old version exported and the new one dropped is a removed symbol, reported there.
  it('leaves dropped exports to the removed-symbol check', () => {
    const judged = judgeRequires('cjs', 'esm', [ref({ symbol: 'parse', via: 'destructured' })], {
      fromExports: exportsOf('parse'),
      toExports: exportsOf('serialize'),
      runtime: { engines: '>=22.12' },
    });
    expect(judged).toBeNull();
  });

  // An unreadable surface would make every property look missing.
  it('skips the export judgement when a side could not be read', () => {
    const judged = judgeRequires(
      'cjs',
      'esm',
      [ref({ symbol: 'red', via: 'namespace', line: 3 })],
      {
        fromExports: exportsOf('default'),
        toExports: null,
        runtime: { engines: '>=22.12' },
      },
    );
    expect(judged).toBeNull();
  });

  it('only warns about older Node when the project could run on one', () => {
    const judge = (engines?: string) =>
      judgeRequires('cjs', 'esm', [ref({ symbol: 'v4', via: 'destructured' })], {
        fromExports: exportsOf('v4'),
        toExports: exportsOf('v4'),
        runtime: engines ? { engines } : {},
      });
    expect(judge('>=18')!.olderNode).toHaveLength(1);
    expect(judge()!.olderNode).toHaveLength(1);
    expect(judge('>=22.12')).toBeNull();
  });

  it('blocks every require site when the exports map offers require nothing', () => {
    const judged = judgeRequires(
      'cjs',
      'unexported',
      [ref({}), ref({ symbol: 'red', via: 'namespace', line: 3 })],
      {
        fromExports: exportsOf('default'),
        toExports: exportsOf('default'),
        runtime: {},
      },
    );
    expect(judged!.broken.map((b) => b.line)).toEqual([1]);
  });

  // No Node version loads an async ES module through require(), so engines do not help.
  it('blocks every require() of an ES module that uses top-level await', () => {
    const judged = judgeRequires(
      'cjs',
      'esm',
      [ref({ symbol: 'v4', via: 'destructured', line: 2 })],
      {
        fromExports: exportsOf('v4'),
        toExports: exportsOf('v4'),
        runtime: { engines: '>=22.12' },
        asyncModule: true,
      },
    );
    expect(judged).toEqual({
      from: 'cjs',
      to: 'esm',
      broken: [
        {
          file: 'src/log.js',
          line: 2,
          why: 'the ES module uses top-level await, so require() throws ERR_REQUIRE_ASYNC_MODULE on every Node',
        },
      ],
      olderNode: [],
    });
  });

  it('has nothing to say without a CommonJS-to-ESM change or a require', () => {
    const ctx = { fromExports: exportsOf('default'), toExports: exportsOf('default'), runtime: {} };
    expect(judgeRequires('esm', 'esm', [ref({})], ctx)).toBeNull();
    expect(judgeRequires('cjs', 'cjs', [ref({})], ctx)).toBeNull();
    expect(judgeRequires('cjs', 'esm', [ref({ loader: undefined })], ctx)).toBeNull();
  });
});

describe('the scanner marks require() loads', () => {
  it('marks bindings, destructuring, import-equals, and member reads, and follows direct calls', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lurq-require-'));
    try {
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(
        join(dir, 'src/load.ts'),
        [
          `const chalk = require('chalk');`,
          `chalk('x');`,
          `chalk.red('y');`,
          `import fetch = require('node-fetch');`,
          `fetch('u');`,
          `const { v4 } = require('uuid');`,
          `import { parse } from 'cookie';`,
          `export const p = parse;`,
        ].join('\n'),
      );
      const refs = scanReferences(dir);
      const get = (pkg: string, sym: string) =>
        refs.find((r) => r.package === pkg)!.symbols.get(sym)![0]!;
      expect(get('chalk', 'default')).toMatchObject({ loader: 'require' });
      expect(get('chalk', 'default').calls).toContainEqual(
        expect.objectContaining({ line: 2, args: 1 }),
      );
      expect(get('chalk', 'red')).toMatchObject({ via: 'namespace', loader: 'require' });
      expect(get('node-fetch', 'default').calls).toContainEqual(
        expect.objectContaining({ line: 5, args: 1 }),
      );
      expect(get('uuid', 'v4')).toMatchObject({ via: 'destructured', loader: 'require' });
      expect(get('cookie', 'parse').loader).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('what the new version requires of the project', () => {
  const manifest = (over: object = {}) => ({ name: 'x', version: '1.0.0', ...over });

  it('reports a Node floor above what the project declares', () => {
    expect(
      judgeRequirements(
        manifest({ engines: { node: '>=14' } }),
        manifest({ engines: { node: '>=20' } }),
        { engines: '>=18' },
      ),
    ).toEqual([
      { kind: 'engines', name: 'node', needs: '>=20', has: '>=18 (package.json engines)' },
    ]);
  });

  it('does not blame the upgrade for a floor the old version already had', () => {
    expect(
      judgeRequirements(
        manifest({ engines: { node: '>=20' } }),
        manifest({ engines: { node: '>=20.5' } }),
        { engines: '>=18' },
      ),
    ).toEqual([]);
  });

  // `.nvmrc` "20" is some Node 20. A floor inside that line is reachable.
  it('judges a pinned Node line as a line, not as its .0 floor', () => {
    const pinned = { nodeVersionFile: { name: '.nvmrc', value: '20' } };
    expect(
      judgeRequirements(
        manifest(),
        manifest({ engines: { node: '^20.19.0 || >=22.12.0' } }),
        pinned,
      ),
    ).toEqual([]);
    expect(judgeRequirements(manifest(), manifest({ engines: { node: '>=22' } }), pinned)).toEqual([
      { kind: 'engines', name: 'node', needs: '>=22', has: '20 (.nvmrc)' },
    ]);
  });

  it('reports a peer the installed version no longer satisfies, and skips peers the project lacks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lurq-peers-'));
    try {
      mkdirSync(join(dir, '.git'));
      mkdirSync(join(dir, 'node_modules/react'), { recursive: true });
      writeFileSync(
        join(dir, 'node_modules/react/package.json'),
        JSON.stringify({ name: 'react', version: '18.3.1' }),
      );
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ dependencies: { react: '^18.2.0' } }),
      );
      const found = judgeRequirements(
        manifest({ peerDependencies: { react: '^18.0.0' } }),
        manifest({ peerDependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' } }),
        { root: dir },
      );
      expect(found).toEqual([
        { kind: 'peer', name: 'react', needs: '^19.0.0', has: '18.3.1 (installed)' },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to the declared range, and skips optional peers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lurq-peers-'));
    try {
      mkdirSync(join(dir, '.git'));
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ dependencies: { vue: '^2.7.0', sass: '^1.0.0' } }),
      );
      const found = judgeRequirements(
        manifest(),
        manifest({
          peerDependencies: { vue: '^3.0.0', sass: '^2.0.0' },
          peerDependenciesMeta: { sass: { optional: true } },
        }),
        { root: dir },
      );
      expect(found).toEqual([
        { kind: 'peer', name: 'vue', needs: '^3.0.0', has: '^2.7.0 (package.json)' },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('side-effect loads', () => {
  it('records them as loads that claim no exports', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lurq-side-effect-'));
    try {
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(
        join(dir, 'src/boot.ts'),
        [
          `import 'dotenv/config';`,
          `require('source-map-support/register');`,
          `import './local.css';`,
        ].join('\n'),
      );
      const refs = scanReferences(dir);
      const get = (pkg: string) => refs.find((r) => r.package === pkg)!.symbols.get('default')![0]!;
      expect(get('dotenv')).toMatchObject({
        via: 'side-effect',
        specifier: 'dotenv/config',
        line: 1,
      });
      expect(get('dotenv').loader).toBeUndefined();
      expect(get('source-map-support')).toMatchObject({
        via: 'side-effect',
        loader: 'require',
        line: 2,
      });
      expect(refs.map((r) => r.package)).not.toContain('./local.css');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
