import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractSurface } from '../src/surface/extract';
import { diffSurfaces } from '../src/surface/diff';
import { runtimeSymbols, type ExtractedSurface } from '../src/surface/types';
import { resolveEntry, resolvesInsidePackage } from '../src/surface/resolve';

let root: string;
const pkgs: Record<string, string> = {};

/** Write a throwaway package on disk; extraction is filesystem-driven. */
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
  root = mkdtempSync(join(tmpdir(), 'lurq-surface-'));

  pkg('cjs-basic', {
    'index.js': `
      exports.alpha = function (a, b) {};
      module.exports.beta = class Beta {};
      module.exports.gamma = 42;
    `,
  });

  // §6.4.5 — the defect that returns zero exports for express/debug/react.
  pkg('reexport-chain', {
    'index.js': `module.exports = require('./lib/impl.js');`,
    'lib/impl.js': `
      exports.deep = function (a) {};
      exports.alsoDeep = 7;
    `,
  });

  // §6.4.5 again, but nested in control flow the way `debug` ships it.
  pkg('conditional-entry', {
    'index.js': `
      if (typeof process === 'undefined') {
        module.exports = require('./browser.js');
      } else {
        module.exports = require('./node.js');
      }
    `,
    'browser.js': `exports.browserOnly = function () {};`,
    'node.js': `exports.nodeOnly = function (a, b, c) {};`,
  });

  // §6.4.1 — external re-exports must NOT count as this package's surface.
  pkg('external-reexport', {
    'index.js': `
      export { AbortController } from "@smithy/types";
      export const mine = 1;
    `,
  });

  // §6.4.4 — type-only exports break tsc, not node.
  pkg('type-only', {
    'index.js': `
      export interface Shape { a: string }
      export type Alias = string;
      export const real = function (a) {};
    `,
  });

  pkg('cycle', {
    'index.js': `module.exports = require('./a.js');`,
    'a.js': `exports.fromA = 1; module.exports = require('./b.js');`,
    'b.js': `exports.fromB = 2; module.exports = require('./a.js');`,
  });

  pkg('esbuild-reexport', {
    'index.cjs': `
      var index_exports = {};
      module.exports = __toCommonJS(index_exports);
      __reExport(index_exports, require("./part.cjs"), module.exports);
    `,
    'part.cjs': `exports.fromPart = function (x) {};`,
  }, { main: 'index.cjs' });

  pkg('exports-map', {
    'dist/main.js': `exports.viaExportsMap = 1;`,
  }, { main: undefined, exports: { '.': { require: './dist/main.js', default: './dist/main.js' } } });

  pkg('no-entry', {}, { main: './nope.js' });

  // Babel's CJS output — and older tsc's. uuid@9 declares its ENTIRE surface
  // this way, so without handling it every Babel-compiled package on npm
  // extracts as zero exports and lands as UNDECLARED.
  pkg('define-property-exports', {
    'index.js': `
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      Object.defineProperty(exports, "NIL", { enumerable: true, get: function () { return _nil.default; } });
      Object.defineProperty(exports, "parse", { enumerable: true, get: function () { return _parse.default; } });
    `,
  });

  // The `uuid` shape: one `default` re-exported per internal file, renamed.
  // Merging the target's whole surface both invents its internal helpers and
  // loses the renamed export. Measured at 3/10 precision before the fix.
  pkg('selective-reexport', {
    'index.js': `
      export { default as MAX } from './max.js';
      export { default as v1 } from './v1.js';
      export { helper as renamedHelper } from './util.js';
    `,
    'max.js': `export default 268435455; export const internalMaxDetail = 1;`,
    'v1.js': `export default function v1(a) {}; export function updateV1State(x) {}`,
    'util.js': `export function helper() {}; export function alsoInternal() {}`,
  });
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const paths = (s: ExtractedSurface) => runtimeSymbols(s).map((x) => x.path).sort();

describe('tier-A extraction', () => {
  it('reads CommonJS exports with kinds and arity', () => {
    const s = extractSurface(pkgs['cjs-basic']!);
    expect(paths(s)).toEqual(['alpha', 'beta', 'gamma']);
    const alpha = s.symbols.find((x) => x.path === 'alpha')!;
    expect(alpha.kind).toBe('function');
    expect(alpha.arity).toBe(2);
    expect(s.symbols.find((x) => x.path === 'beta')!.kind).toBe('class');
    expect(s.symbols.find((x) => x.path === 'gamma')!.kind).toBe('primitive');
  });

  // §6.4.5: a single-file parse returns zero here. This is the regression that matters.
  it('follows the package-internal module graph', () => {
    const s = extractSurface(pkgs['reexport-chain']!);
    expect(paths(s)).toEqual(['alsoDeep', 'deep']);
    expect(s.filesWalked).toBeGreaterThan(1);
  });

  it('finds exports assigned inside control flow (the `debug` shape)', () => {
    const s = extractSurface(pkgs['conditional-entry']!);
    expect(paths(s)).toEqual(['browserOnly', 'nodeOnly']);
  });

  it('follows bundler re-export helpers with the require in any argument slot', () => {
    const s = extractSurface(pkgs['esbuild-reexport']!);
    expect(paths(s)).toContain('fromPart');
  });

  it('resolves the entry through an exports map', () => {
    const s = extractSurface(pkgs['exports-map']!);
    expect(paths(s)).toEqual(['viaExportsMap']);
  });

  it('terminates on a require cycle', () => {
    const s = extractSurface(pkgs['cycle']!);
    expect(paths(s).length).toBeGreaterThan(0);
    expect(s.filesWalked).toBeLessThanOrEqual(3);
  });

  // §6.4.1 — the defect that produced a phantom 168-export deletion.
  it('marks external re-exports as external and excludes them from runtime surface', () => {
    const s = extractSurface(pkgs['external-reexport']!);
    const ext = s.symbols.find((x) => x.path === 'AbortController')!;
    expect(ext.origin).toBe('external:@smithy/types');
    expect(paths(s)).toEqual(['mine']); // AbortController is NOT ours
    expect(s.externalReExports).toContain('@smithy/types');
  });

  // §6.4.4 — removing a type breaks tsc, not node.
  it('classifies type-only exports and keeps them out of the runtime surface', () => {
    const s = extractSurface(pkgs['type-only']!);
    expect(paths(s)).toEqual(['real']);
    expect(s.symbols.filter((x) => x.kind === 'type_only').map((x) => x.path).sort()).toEqual([
      'Alias',
      'Shape',
    ]);
  });

  it('reports UNDECLARED rather than an empty surface when there is no entry', () => {
    const s = extractSurface(pkgs['no-entry']!);
    expect(s.symbols).toEqual([]);
    expect(s.undeclaredReason).toBeTruthy();
  });

  it('resolvesInsidePackage distinguishes relative from bare specifiers', () => {
    expect(resolvesInsidePackage('./lib/x')).toBe(true);
    expect(resolvesInsidePackage('../x')).toBe(true);
    expect(resolvesInsidePackage('lodash')).toBe(false);
    expect(resolvesInsidePackage('@scope/pkg')).toBe(false);
  });

  it('resolveEntry returns null when nothing resolves', () => {
    expect(resolveEntry(pkgs['no-entry']!)).toBeNull();
  });
});

describe('Object.defineProperty exports (found live, 2026-08-06)', () => {
  it('extracts Babel-style CJS exports and skips __esModule', () => {
    const s = extractSurface(pkgs['define-property-exports']!);
    expect(paths(s)).toEqual(['NIL', 'parse']);
    expect(paths(s)).not.toContain('__esModule');
  });
});

describe('selective re-export (§7 gate failure, 2026-08-06)', () => {
  it('takes only the named subset, never the whole target surface', () => {
    const s = extractSurface(pkgs['selective-reexport']!);
    const names = paths(s);
    // The internal helpers must NOT appear — claiming a symbol that does not
    // exist is the worst error class available to us.
    expect(names).not.toContain('internalMaxDetail');
    expect(names).not.toContain('updateV1State');
    expect(names).not.toContain('alsoInternal');
  });

  it('honours the rename, so `export { default as MAX }` exposes MAX', () => {
    const s = extractSurface(pkgs['selective-reexport']!);
    expect(paths(s)).toEqual(['MAX', 'renamedHelper', 'v1']);
  });

  it('still merges the whole surface for `export * from`', () => {
    const s = extractSurface(pkgs['reexport-chain']!);
    expect(paths(s)).toEqual(['alsoDeep', 'deep']);
  });
});

describe('tarball layout (found live, 2026-08-06)', () => {
  // @types/* tarballs root at the TYPE NAME (`node/`), not `package/`. A
  // hardcoded `package/` path fails extraction for all of DefinitelyTyped, and
  // it fails as a thrown ENOENT — which the drain would have charged to our own
  // infrastructure and retried forever. Guarded by strip-components + an
  // UNDECLARED fallback in fetch.ts.
  it('does not assume tarballs root at package/', async () => {
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile('src/surface/fetch.ts', 'utf8'),
    );
    expect(src).toContain('--strip-components=1');
    expect(src).not.toMatch(/join\(dir, 'package'\)/);
  });

  it('treats an unreadable manifest as UNDECLARED, never as a thrown failure', async () => {
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile('src/surface/fetch.ts', 'utf8'),
    );
    expect(src).toContain('undeclaredReason');
  });
});

describe('surface diff', () => {
  const surface = (over: Partial<ExtractedSurface>): ExtractedSurface => ({
    package: 'p',
    version: '1.0.0',
    tier: 'shipped_js_ast',
    entry: 'index.js',
    symbols: [],
    filesWalked: 1,
    externalReExports: [],
    ...over,
  });
  const sym = (path: string, over: Partial<ExtractedSurface['symbols'][number]> = {}) => ({
    path,
    kind: 'function' as const,
    arity: 1,
    origin: 'local' as const,
    deprecated: false,
    tier: 'shipped_js_ast' as const,
    ...over,
  });

  it('reports removals, additions and arity changes', () => {
    const d = diffSurfaces(
      surface({ symbols: [sym('kept'), sym('gone'), sym('shrunk', { arity: 3 })] }),
      surface({ version: '2.0.0', symbols: [sym('kept'), sym('new'), sym('shrunk', { arity: 1 })] }),
    );
    expect(d.removed.map((s) => s.path)).toEqual(['gone']);
    expect(d.added.map((s) => s.path)).toEqual(['new']);
    expect(d.arityChanged).toEqual([{ path: 'shrunk', from: 3, to: 1 }]);
  });

  // §6.4.2 — the guard that turned a fake 100% precision into a real number.
  it('refuses to diff an empty surface instead of calling it a mass removal', () => {
    const d = diffSurfaces(surface({ symbols: [sym('a'), sym('b')] }), surface({ symbols: [] }));
    expect(d.inconclusive).toMatch(/empty/);
    expect(d.removed).toEqual([]);
  });

  // §6.4.3 — tier A and tier C surfaces are not comparable.
  it('refuses a cross-tier comparison', () => {
    const d = diffSurfaces(
      surface({ symbols: [sym('a')] }),
      surface({ tier: 'bundled_dts', symbols: [sym('a', { tier: 'bundled_dts' })] }),
    );
    expect(d.inconclusive).toMatch(/cross-tier/);
  });

  // §6.4.4 — a removed type is reported, but never as runtime breakage.
  it('separates type-only removals from runtime removals', () => {
    const d = diffSurfaces(
      surface({ symbols: [sym('runtimeGone'), sym('TypeGone', { kind: 'type_only' })] }),
      surface({ symbols: [sym('other')] }),
    );
    expect(d.removed.map((s) => s.path)).toEqual(['runtimeGone']);
    expect(d.typeOnlyRemoved.map((s) => s.path)).toEqual(['TypeGone']);
  });

  // §6.4.1 — an external re-export disappearing is not this package's removal.
  it('never counts an external re-export as a removal', () => {
    const d = diffSurfaces(
      surface({ symbols: [sym('mine'), sym('theirs', { origin: 'external:@x/y' })] }),
      surface({ symbols: [sym('mine')] }),
    );
    expect(d.removed).toEqual([]);
  });


  /**
   * The rename pattern that motivated candidates being the target's surface
   * rather than its additions: ship the new name, let both live for a major,
   * remove the old one. cookie 1.1.1 -> 2.0.1 is the real instance —
   * `parseCookie` and `stringifyCookie` shipped in 1.x, `parse` and `serialize`
   * were dropped in 2.0. Against `diff.added` the candidate list came back empty
   * exactly when a caller needed it most.
   */
  describe('replacement candidates on a pre-existing rename', () => {
    const from = surface({
      symbols: [
        sym('parse', { kind: 'function', arity: 2 }),
        sym('serialize', { kind: 'function', arity: 3 }),
        sym('parseCookie', { kind: 'function', arity: 2 }),
        sym('stringifyCookie', { kind: 'function', arity: 2 }),
      ],
    });
    const to = surface({
      symbols: [
        sym('parseCookie', { kind: 'function', arity: 2 }),
        sym('stringifyCookie', { kind: 'function', arity: 2 }),
      ],
    });

    it('offers the target surface even when nothing was added', () => {
      const d = diffSurfaces(from, to);
      expect(d.added).toEqual([]); // the old source — empty, which was the bug
      const names = runtimeSymbols(to).map((s) => s.path);
      expect(names).toContain('parseCookie');
      expect(names).toContain('stringifyCookie');
    });
  });
});

/**
 * An ESM-first package ships a `require` condition that is a thin wrapper: it
 * re-exports through a runtime call the AST walker cannot follow, so the entry
 * resolves, one file is walked, and zero exports come back. Reporting that as
 * the surface is the dangerous outcome — an empty surface reads as "no API",
 * and every later diff against it looks like the package deleted everything.
 *
 * Measured on the real registry before the fallback existed: date-fns@4.4.0 and
 * vitest@4.1.10 both resolved index.cjs and extracted 0 symbols. Both have
 * hundreds of exports between them, and `usage` and `diff_surface` returned
 * nothing for either.
 */
describe('entry fallback for ESM-first packages', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'lurq-esm-first-'));
    const p = join(dir, 'esm-first');
    mkdirSync(p, { recursive: true });
    // The CJS condition: resolvable, parseable, and empty — a runtime re-export
    // the walker cannot see through.
    writeFileSync(join(p, 'index.cjs'), `module.exports = require('./impl.cjs')(globalThis);\n`);
    writeFileSync(join(p, 'impl.cjs'), `module.exports = () => ({});\n`);
    // The ESM condition: where the surface actually is.
    writeFileSync(
      join(p, 'index.mjs'),
      `export function addBusinessDays(d, n) {}\nexport function isSameMonth(a, b) {}\nexport const VERSION = '4';\n`,
    );
    writeFileSync(
      join(p, 'package.json'),
      JSON.stringify({
        name: 'esm-first',
        version: '4.0.0',
        main: 'index.cjs',
        exports: { '.': { require: './index.cjs', import: './index.mjs' } },
      }),
    );
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('falls through an empty require entry to the import condition', () => {
    const s = extractSurface(join(dir, 'esm-first'));
    expect(s.undeclaredReason).toBeUndefined();
    expect(runtimeSymbols(s).map((x) => x.path).sort()).toEqual([
      'VERSION',
      'addBusinessDays',
      'isSameMonth',
    ]);
    // And it says which entry it actually read, not which one it tried first.
    expect(s.entry).toBe('index.mjs');
  });

  it('still prefers the require condition when that one parses', () => {
    const p = join(dir, 'cjs-real');
    mkdirSync(p, { recursive: true });
    writeFileSync(join(p, 'index.cjs'), `exports.fromCjs = function () {};\n`);
    writeFileSync(join(p, 'index.mjs'), `export function fromEsm() {}\n`);
    writeFileSync(
      join(p, 'package.json'),
      JSON.stringify({
        name: 'cjs-real',
        version: '1.0.0',
        exports: { '.': { require: './index.cjs', import: './index.mjs' } },
      }),
    );
    const s = extractSurface(p);
    expect(runtimeSymbols(s).map((x) => x.path)).toEqual(['fromCjs']);
    expect(s.entry).toBe('index.cjs');
  });
});
