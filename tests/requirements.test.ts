import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanReferences, type SymbolReference } from '../src/surface/references';
import { judgeRequires } from '../src/surface/requirements';

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
    const judged = judgeRequires('cjs', 'esm', [ref({ calls: [{ line: 4, args: 1 }, { line: 5, args: null }] })], {
      fromExports: exportsOf('default'),
      toExports: exportsOf('default'),
      runtime: {},
    });
    expect(judged!.broken).toEqual([
      { file: 'src/log.js', line: 4, why: 'require() now returns the module namespace, which cannot be called' },
    ]);
    expect(judged!.olderNode).toEqual([{ file: 'src/log.js', line: 1 }]);
  });

  // `chalk.red` was a property of chalk 4's exported value; chalk 5 has no `red` export.
  it('blocks a property the ES module does not export', () => {
    const judged = judgeRequires(
      'cjs',
      'esm',
      [ref({}), ref({ symbol: 'red', via: 'namespace', line: 3 }), ref({ symbol: 'chalkStderr', via: 'namespace', line: 6 })],
      { fromExports: exportsOf('default'), toExports: exportsOf('default', 'chalkStderr'), runtime: {} },
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
    const judged = judgeRequires('cjs', 'esm', [ref({ symbol: 'red', via: 'namespace', line: 3 })], {
      fromExports: exportsOf('default'),
      toExports: null,
      runtime: { engines: '>=22.12' },
    });
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
    const judged = judgeRequires('cjs', 'unexported', [ref({}), ref({ symbol: 'red', via: 'namespace', line: 3 })], {
      fromExports: exportsOf('default'),
      toExports: exportsOf('default'),
      runtime: {},
    });
    expect(judged!.broken.map((b) => b.line)).toEqual([1]);
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
      const get = (pkg: string, sym: string) => refs.find((r) => r.package === pkg)!.symbols.get(sym)![0]!;
      expect(get('chalk', 'default')).toMatchObject({ loader: 'require' });
      expect(get('chalk', 'default').calls).toContainEqual({ line: 2, args: 1 });
      expect(get('chalk', 'red')).toMatchObject({ via: 'namespace', loader: 'require' });
      expect(get('node-fetch', 'default').calls).toContainEqual({ line: 5, args: 1 });
      expect(get('uuid', 'v4')).toMatchObject({ via: 'destructured', loader: 'require' });
      expect(get('cookie', 'parse').loader).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
