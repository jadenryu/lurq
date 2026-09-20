import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { typeChecker } from '../src/surface/typecheck';

let root: string;

function write(rel: string, body: string): void {
  const full = join(root, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body);
}

/** An unpacked `cookie` tarball. `dts: null` ships no type definitions. */
function version(dir: string, dts: string | null): string {
  write(
    `${dir}/package.json`,
    JSON.stringify({
      name: 'cookie',
      version: '1.0.0',
      main: 'index.js',
      ...(dts === null ? {} : { types: 'index.d.ts' }),
    }),
  );
  write(`${dir}/index.js`, 'exports.parse = function (str, options) {};');
  if (dts !== null) write(`${dir}/index.d.ts`, dts);
  return join(root, dir);
}

const COMPILER_OPTIONS = {
  strict: true,
  target: 'ES2022',
  module: 'ESNext',
  moduleResolution: 'Bundler',
  noEmit: true,
  skipLibCheck: true,
  types: [],
};

let v1: string;
let v2: string;
let untyped: string;
let garbled: string;
let widened: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'lurq-types-'));

  v1 = version(
    'v1',
    `export interface Options { decode?: (s: string) => string }
     export declare function parse(str: string, options?: Options): Record<string, string>;`,
  );
  // Renames an option, makes it required, and widens the return type: nothing
  // here changes the runtime export surface, and all of it breaks the caller.
  v2 = version(
    'v2',
    `export interface Options { decodeValue?: (s: string) => string }
     export declare function parse(str: string, options: Options): Record<string, string | undefined>;`,
  );
  untyped = version('untyped', null);
  garbled = version('garbled', `export declare function parse(str: string: number;`);
  // v1's call shape with a wider return type: the wrapper still compiles, and
  // the code that uses the wrapper does not.
  widened = version(
    'widened',
    `export interface Options { decode?: (s: string) => string }
     export declare function parse(str: string, options?: Options): Record<string, string | undefined>;`,
  );
  write(
    'hop/tsconfig.json',
    JSON.stringify({ compilerOptions: COMPILER_OPTIONS, include: ['src'] }),
  );
  write(
    'hop/src/cookies.ts',
    `import { parse } from 'cookie';\nexport const read = (header: string) => parse(header);`,
  );
  write(
    'hop/src/session.ts',
    `import { read } from './cookies';\nexport const id: string = read('id=1')['id'];`,
  );

  // No node_modules anywhere: the check has to work on a fresh checkout.
  write(
    'project/tsconfig.json',
    JSON.stringify({ compilerOptions: COMPILER_OPTIONS, include: ['src'] }),
  );
  write(
    'project/src/session.ts',
    [
      `import { parse, type Options } from 'cookie';`,
      `export const jar: Record<string, string> = parse('a=b');`,
      `export const opts: Options = { decode: (s) => s };`,
      `export const already: number = 'this error predates the upgrade';`,
    ].join('\n'),
  );
  write('project/scripts/outside.ts', `import { parse } from 'cookie';\nparse('a');`);

  // Vite's layout: the root tsconfig includes nothing and defers to references.
  write(
    'vite/tsconfig.json',
    JSON.stringify({ files: [], references: [{ path: './tsconfig.app.json' }] }),
  );
  write(
    'vite/tsconfig.app.json',
    JSON.stringify({ compilerOptions: COMPILER_OPTIONS, include: ['src'] }),
  );
  write('vite/src/main.ts', `import { parse } from 'cookie';\nexport const jar = parse('a=b');`);
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('type check across an upgrade', () => {
  it('reports the errors the new version introduces, at file and line', () => {
    const check = typeChecker(ts, join(root, 'project'))('cookie', v1, v2, ['src/session.ts']);
    expect(check.checked).toBe(true);
    if (!check.checked) return;
    expect(check.files).toBe(1);
    const lines = [...new Set(check.introduced.map((e) => e.line))].sort();
    expect(lines).toEqual([2, 3]);
    const codes = check.introduced.map((e) => e.code);
    expect(codes).toContain(2554); // expected 2 arguments, got 1
    expect(codes).toContain(2353); // `decode` is not a known property
    expect(check.introduced.every((e) => e.file === 'src/session.ts')).toBe(true);
  });

  // Line 4 was already an error. Reporting it would blame the upgrade for it.
  it('never reports an error the code already had', () => {
    const check = typeChecker(ts, join(root, 'project'))('cookie', v1, v2, ['src/session.ts']);
    expect(check.checked && check.introduced.some((e) => e.line === 4)).toBe(false);
  });

  it('is clean when the types did not change', () => {
    const check = typeChecker(ts, join(root, 'project'))('cookie', v1, v1, ['src/session.ts']);
    expect(check).toEqual({ checked: true, files: 1, introduced: [] });
  });

  // Types from @types/* do not move with the upgrade; comparing them says nothing.
  it('declines when the new version ships no type definitions', () => {
    const check = typeChecker(ts, join(root, 'project'))('cookie', v1, untyped, ['src/session.ts']);
    expect(check).toEqual({
      checked: false,
      reason: 'the new version ships no type definitions of its own',
    });
  });

  // Half-parsed declarations become `any`, and `any` hides errors. Unchecked, not clean.
  it('declines when the definitions do not parse', () => {
    const check = typeChecker(ts, join(root, 'project'))('cookie', v1, garbled, ['src/session.ts']);
    expect(check.checked).toBe(false);
    expect(!check.checked && check.reason).toMatch(/do not parse/);
  });

  it('declines for files no tsconfig includes', () => {
    const check = typeChecker(ts, join(root, 'project'))('cookie', v1, v2, ['scripts/outside.ts']);
    expect(check).toEqual({
      checked: false,
      reason: 'no tsconfig.json includes the files that import it',
    });
  });

  it('follows a solution-style tsconfig to the project that includes the file', () => {
    const check = typeChecker(ts, join(root, 'vite'))('cookie', v1, v2, ['src/main.ts']);
    expect(check.checked).toBe(true);
    expect(check.checked && check.introduced.map((e) => e.code)).toContain(2554);
  });

  it('checks the files that import an importer, where a widened type lands', () => {
    const check = typeChecker(ts, join(root, 'hop'))('cookie', v1, widened, ['src/cookies.ts']);
    expect(check.checked && check.files).toBe(2);
    expect(check.checked && check.introduced.map((e) => `${e.file}:${e.line}:${e.code}`)).toEqual([
      'src/session.ts:2:2322',
    ]);
  });

  it('stops once the budget is spent', () => {
    const check = typeChecker(ts, join(root, 'project'), { budgetMs: -1 })('cookie', v1, v2, [
      'src/session.ts',
    ]);
    expect(check).toEqual({
      checked: false,
      reason: 'type check budget used up by earlier packages',
    });
  });
});

describe('type check environments that are not a clean npm install', () => {
  const dirs: string[] = [];
  const at = (dir: string, files: Record<string, string>) => {
    for (const [file, body] of Object.entries(files)) {
      mkdirSync(join(dir, file, '..'), { recursive: true });
      writeFileSync(join(dir, file), body);
    }
    return dir;
  };
  const temp = () => {
    const dir = mkdtempSync(join(tmpdir(), 'lurq-types-env-'));
    dirs.push(dir);
    return dir;
  };
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
  const tsconfig = JSON.stringify({ compilerOptions: COMPILER_OPTIONS, include: ['src'] });

  // CI runs the check before installing. Types that now come from the package's
  // own dependency read as an empty interface, and an install would clear that.
  it('declines when the new types import a dependency that is not installed', () => {
    const project = at(temp(), {
      'tsconfig.json': tsconfig,
      'src/a.ts': `import { make } from 'lib';\nconst o = make({ foo: 'x' });\nexport const f: string = o.foo;\n`,
    });
    const from = at(temp(), {
      'package.json': JSON.stringify({ name: 'lib', version: '1.0.0', types: 'index.d.ts' }),
      'index.d.ts': `export interface Opts { foo: string }\nexport declare function make(o: Opts): Opts;\n`,
    });
    const to = at(temp(), {
      'package.json': JSON.stringify({
        name: 'lib',
        version: '1.1.0',
        types: 'index.d.ts',
        dependencies: { '@lib/core': '1.1.0' },
      }),
      'index.d.ts': `import type { CoreOpts } from '@lib/core';\nexport interface Opts extends CoreOpts {}\nexport declare function make(o: Opts): Opts;\n`,
    });
    expect(typeChecker(ts, project)('lib', from, to, ['src/a.ts'])).toEqual({
      checked: false,
      reason: "the new version's types import @lib/core, which is not installed here",
    });
  });

  // The zod + @hookform/resolvers shape: a peer-dependent adapter links to pnpm's
  // store copy. Leaving that copy on the old version split one type in two.
  it("swaps pnpm's store copy too, so a peer adapter sees the same version", () => {
    const lib = (version: string) => ({
      'package.json': JSON.stringify({
        name: 'schema',
        version,
        types: 'index.d.ts',
        main: 'index.js',
      }),
      'index.d.ts': `export declare class Schema { private _cached; parse(x: unknown): unknown; }\nexport declare function object(): Schema;\n`,
      'index.js': 'exports.object = () => ({})',
    });
    const root = temp();
    const store = join(root, 'node_modules/.pnpm');
    at(join(store, 'schema@1.0.0/node_modules/schema'), lib('1.0.0'));
    at(join(store, 'adapter@1.0.0_schema@1.0.0/node_modules/adapter'), {
      'package.json': JSON.stringify({
        name: 'adapter',
        version: '1.0.0',
        types: 'index.d.ts',
        peerDependencies: { schema: '*' },
      }),
      'index.d.ts': `import { Schema } from 'schema';\nexport declare function resolver(s: Schema): void;\n`,
    });
    symlinkSync(
      join(store, 'schema@1.0.0/node_modules/schema'),
      join(store, 'adapter@1.0.0_schema@1.0.0/node_modules/schema'),
    );
    symlinkSync(join(store, 'schema@1.0.0/node_modules/schema'), join(root, 'node_modules/schema'));
    symlinkSync(
      join(store, 'adapter@1.0.0_schema@1.0.0/node_modules/adapter'),
      join(root, 'node_modules/adapter'),
    );
    at(root, {
      'tsconfig.json': tsconfig,
      'src/form.ts': `import { object } from 'schema';\nimport { resolver } from 'adapter';\nresolver(object());\n`,
    });
    const check = typeChecker(ts, root)(
      'schema',
      at(temp(), lib('1.0.0')),
      at(temp(), lib('1.0.1')),
      ['src/form.ts'],
    );
    expect(check).toEqual({ checked: true, files: 1, introduced: [] });
  });
});
