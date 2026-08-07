import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractTypeSurface, resolveTypesEntry } from '../src/surface/dts';
import { extractSurface } from '../src/surface/extract';
import { diffSurfaces } from '../src/surface/diff';

let root: string;
const pkgs: Record<string, string> = {};

function pkg(name: string, files: Record<string, string>, manifest: object = {}): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body);
  }
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name, version: '1.0.0', main: 'index.js', ...manifest }),
  );
  pkgs[name] = dir;
  return dir;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'lurq-dts-'));

  pkg(
    'typed',
    {
      'index.js': `exports.doThing = function (a, b) {}; exports.legacy = function () {};`,
      'index.d.ts': `
        /** Does the thing. */
        export declare function doThing<T>(a: T, b: string): Promise<T>;
        /**
         * @deprecated use doThing instead
         */
        export declare function legacy(): void;
        export interface Options { retries: number }
        export type Mode = 'fast' | 'slow';
      `,
    },
    { types: './index.d.ts' },
  );

  // Overload set — one callable name, several signatures.
  pkg(
    'overloaded',
    {
      'index.js': `exports.parse = function (x) {};`,
      'index.d.ts': `
        export declare function parse(input: string): object;
        export declare function parse(input: Buffer): object;
      `,
    },
    { types: './index.d.ts' },
  );

  // §6.4.5 at tier C: declarations import './x.js' but ship './x.d.ts'.
  pkg(
    'dts-reexport',
    {
      'index.js': `module.exports = require('./inner.js');`,
      'index.d.ts': `export * from "./inner.js";`,
      'inner.d.ts': `export declare const deepValue: number;
        export declare function deepFn(a: string): void;`,
    },
    { types: './index.d.ts' },
  );

  pkg('untyped', { 'index.js': `exports.thing = 1;` });
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('tier C — bundled .d.ts', () => {
  it('captures full signatures including generics', () => {
    const s = extractTypeSurface(pkgs['typed']!);
    const fn = s.symbols.find((x) => x.path === 'doThing')!;
    expect(fn.signature).toContain('<T>');
    expect(fn.signature).toContain('Promise<T>');
    expect(fn.tier).toBe('bundled_dts');
  });

  it('detects @deprecated, which tier A cannot see', () => {
    const s = extractTypeSurface(pkgs['typed']!);
    expect(s.symbols.find((x) => x.path === 'legacy')!.deprecated).toBe(true);
    expect(s.symbols.find((x) => x.path === 'doThing')!.deprecated).toBe(false);
  });

  it('marks interfaces and type aliases type_only', () => {
    const s = extractTypeSurface(pkgs['typed']!);
    for (const n of ['Options', 'Mode']) {
      expect(s.symbols.find((x) => x.path === n)!.kind).toBe('type_only');
    }
  });

  it('collapses an overload set into one symbol', () => {
    const s = extractTypeSurface(pkgs['overloaded']!);
    const parse = s.symbols.filter((x) => x.path === 'parse');
    expect(parse).toHaveLength(1);
    expect(parse[0]!.signature).toContain('string');
    expect(parse[0]!.signature).toContain('Buffer');
  });

  // Same defect class as §6.4.5, one tier up: zod's index.d.ts is a bare
  // `export * from "./v3/external.js"` and returned 2 symbols instead of 248.
  it('follows internal re-exports, mapping .js specifiers to .d.ts files', () => {
    const s = extractTypeSurface(pkgs['dts-reexport']!);
    expect(s.symbols.map((x) => x.path).sort()).toEqual(['deepFn', 'deepValue']);
    expect(s.filesWalked).toBeGreaterThan(1);
  });

  it('reports UNDECLARED when the package ships no declarations', () => {
    const s = extractTypeSurface(pkgs['untyped']!);
    expect(s.symbols).toEqual([]);
    expect(s.undeclaredReason).toMatch(/no \.d\.ts/);
    expect(resolveTypesEntry(pkgs['untyped']!)).toBeNull();
  });
});

describe('tier C never answers runtime questions', () => {
  // The whole point of the tier split: a .d.ts can declare things the shipped
  // JS does not have, and §6.4.3 refuses to compare them.
  it('refuses to diff a tier-C surface against a tier-A surface', () => {
    const a = extractSurface(pkgs['typed']!);
    const c = extractTypeSurface(pkgs['typed']!);
    expect(diffSurfaces(a, c).inconclusive).toMatch(/cross-tier/);
    expect(diffSurfaces(c, a).inconclusive).toMatch(/cross-tier/);
  });

  it('reports signature changes only between tier-C surfaces', () => {
    const c1 = extractTypeSurface(pkgs['typed']!);
    const c2 = {
      ...c1,
      version: '2.0.0',
      symbols: c1.symbols.map((s) =>
        s.path === 'doThing' ? { ...s, signature: 'export declare function doThing(a: number): void' } : s,
      ),
    };
    const d = diffSurfaces(c1, c2);
    expect(d.signatureChanged.map((x) => x.path)).toEqual(['doThing']);

    // A tier-A diff must report an EMPTY list rather than a false "no changes":
    // tier A cannot see signatures at all.
    const a = extractSurface(pkgs['typed']!);
    expect(diffSurfaces(a, { ...a, version: '2.0.0' }).signatureChanged).toEqual([]);
  });
});
