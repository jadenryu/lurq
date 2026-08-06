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
});
