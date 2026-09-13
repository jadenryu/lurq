import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SURFACE_CLAIM_KINDS,
  isRootSpecifier,
  packageOfSpecifier,
  scanReferences,
  type SymbolReference,
} from '../src/surface/references';
import {
  checkUpgradeOne,
  formatUpgradeReport,
  isNamespaceMemberClaim,
  judgeCalls,
  type UpgradeReport,
} from '../src/surface/upgrade';

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'lurq-refs-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(
    join(root, 'src/a.ts'),
    `import { escapePath, sync } from 'fast-glob';
     import fg from 'fast-glob';
     import * as pino from 'pino';
     import { join } from 'node:path';
     import { local } from './helper';
     const lodash = require('lodash');
     const { debounce } = require('lodash');
     export const x = () => { fg.stream(); pino.destination(); lodash.throttle(); };
     export const y = [escapePath, sync, debounce, join, local];`,
  );
  writeFileSync(join(root, 'src/helper.ts'), `export const local = 1;`);
  // The zod shape: a named import whose properties are read. `z.string` is a
  // real claim on zod's export surface; `vi.fn` is not a claim on vitest's.
  writeFileSync(
    join(root, 'src/zod-shape.ts'),
    `import { z } from 'zod';
     import { vi } from 'vitest';
     export const schema = z.object({ a: z.string() });
     export type Eff = z.ZodEffects<typeof schema>;
     export const spy = vi.fn();`,
  );
  mkdirSync(join(root, 'node_modules/ignored'), { recursive: true });
  writeFileSync(join(root, 'node_modules/ignored/index.js'), `require('should-not-appear');`);
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('packageOfSpecifier', () => {
  it('maps subpaths and scopes to the package', () => {
    expect(packageOfSpecifier('lodash/fp')).toBe('lodash');
    expect(packageOfSpecifier('@scope/pkg/sub')).toBe('@scope/pkg');
  });

  it('ignores relative paths and node builtins', () => {
    expect(packageOfSpecifier('./local')).toBeNull();
    expect(packageOfSpecifier('../up')).toBeNull();
    expect(packageOfSpecifier('node:path')).toBeNull();
  });
});

describe('reference scanner', () => {
  it('records named ESM imports with file and line', () => {
    const refs = scanReferences(root);
    const fg = refs.find((r) => r.package === 'fast-glob')!;
    expect([...fg.symbols.keys()].sort()).toEqual(
      expect.arrayContaining(['escapePath', 'sync', 'default', 'stream']),
    );
    const esc = fg.symbols.get('escapePath')!;
    expect(esc[0]!.file).toBe('src/a.ts');
    expect(esc[0]!.line).toBe(1);
  });

  it('resolves member reads on a namespace or default binding', () => {
    const refs = scanReferences(root);
    // `import * as pino` + `pino.destination()` — the binding has to be tracked
    // or the report cannot name a line, which is the whole value of §9.0.
    expect([...refs.find((r) => r.package === 'pino')!.symbols.keys()]).toContain('destination');
    expect([...refs.find((r) => r.package === 'fast-glob')!.symbols.keys()]).toContain('stream');
  });

  it('handles CJS require, both whole and destructured', () => {
    const lodash = scanReferences(root).find((r) => r.package === 'lodash')!;
    const names = [...lodash.symbols.keys()];
    expect(names).toContain('debounce'); // destructured
    expect(names).toContain('throttle'); // member read on the binding
  });

  it('records each use of an imported binding with its argument count', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lurq-calls-'));
    try {
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(
        join(dir, 'src/c.ts'),
        [
          `import { parse } from 'cookie';`,
          `import * as qs from 'qs';`,
          `const { debounce } = require('lodash');`,
          `parse('a');`,
          `parse('a', { decode });`,
          `parse(...args);`,
          `export const handlers = [parse];`,
          `qs.stringify(obj, opts); qs.stringify(obj);`,
          `debounce(fn, 10);`,
          `function local(parse: string) { return parse; }`,
        ].join('\n'),
      );
      const refs = scanReferences(dir);
      const calls = (pkg: string, sym: string) =>
        refs.find((r) => r.package === pkg)!.symbols.get(sym)!.flatMap((r) => r.calls ?? []);
      expect(calls('cookie', 'parse').slice(0, 4)).toEqual([
        { line: 4, args: 1 },
        { line: 5, args: 2 },
        { line: 6, args: null },
        { line: 7, args: null },
      ]);
      // Two calls on one line stay two call sites.
      expect(calls('qs', 'stringify')).toEqual([
        { line: 8, args: 2 },
        { line: 8, args: 1 },
      ]);
      expect(calls('lodash', 'debounce')).toEqual([{ line: 9, args: 2 }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Each of these used to be invisible, and an invisible use of a removed
  // export is an upgrade reported safe that throws on load.
  it('follows re-exports, import-equals, inline and dynamic loads, and namespace destructuring', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lurq-forms-'));
    try {
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(
        join(dir, 'src/forms.ts'),
        [
          `import legacy = require('cookie-eq');`,
          `export { parse, serialize as ser } from 'cookie';`,
          `export type { Options } from 'cookie';`,
          `const out = require('qs').stringify(obj, 1);`,
          `export async function load() {`,
          `  const m = await import('pino');`,
          `  m.destination();`,
          `  const { format } = await import('date-fns');`,
          `  format(d, 'yyyy');`,
          `}`,
          `import * as ns from 'semver';`,
          `const { valid, clean: tidy } = ns;`,
          `valid('1.0.0');`,
          `legacy.parse('a');`,
          `const pending = import('not-awaited');`,
        ].join('\n'),
      );
      const refs = scanReferences(dir);
      const get = (pkg: string, sym: string) => refs.find((r) => r.package === pkg)?.symbols.get(sym) ?? [];

      expect(get('cookie', 'parse')[0]).toMatchObject({ via: 'named', line: 2 });
      expect(get('cookie', 'serialize')[0]!.via).toBe('named');
      expect(get('cookie', 'Options')[0]!.via).toBe('type-only');
      expect(get('cookie-eq', 'parse')[0]).toMatchObject({ via: 'namespace', line: 14 });
      expect(get('qs', 'stringify')[0]).toMatchObject({ via: 'namespace', calls: [{ line: 4, args: 2 }] });
      expect(get('pino', 'destination')[0]!.via).toBe('namespace');
      expect(get('date-fns', 'format')[0]).toMatchObject({ via: 'destructured', calls: [{ line: 9, args: 2 }] });
      expect(get('semver', 'valid')[0]).toMatchObject({ via: 'namespace', calls: [{ line: 13, args: 1 }] });
      expect(get('semver', 'clean')[0]!.via).toBe('namespace');
      // An un-awaited import() is a promise, not the module.
      expect(refs.some((r) => r.package === 'not-awaited')).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Stopping silently at the limit would report on files nobody opened.
  it('says when it stopped before the end of the codebase', () => {
    const stats = { files: 0, truncated: false };
    scanReferences(root, { limit: 1, stats });
    expect(stats).toEqual({ files: 1, truncated: true });
    const full = { files: 0, truncated: false };
    scanReferences(root, { stats: full });
    expect(full.truncated).toBe(false);
  });

  it('refuses a version range before touching the registry', async () => {
    const refs = scanReferences(root).find((r) => r.package === 'fast-glob');
    const res = await checkUpgradeOne({ package: 'fast-glob', fromVersion: '^3.2.0', toVersion: '3.3.3' }, refs);
    expect(res).toEqual({ unverified: 'expected exact versions, got ^3.2.0..3.3.3' });
  });

  it('ignores relative imports, builtins, and node_modules', () => {
    const pkgs = scanReferences(root).map((r) => r.package);
    expect(pkgs).not.toContain('node:path');
    expect(pkgs).not.toContain('should-not-appear');
    expect(pkgs).not.toContain('./helper');
  });
});

describe('reference kind classification (miss-rate correction, 2026-08-06)', () => {
  // `chalk.bold` is CORRECT chalk usage — bold is a property of the default
  // export's value, not a module export. Scoring it against a tier-A surface
  // reports a miss on working code, and in check_upgrade it would block a PR on
  // valid code. That is the false positive that gets a CI gate switched off.
  it('separates default-member access from real export claims', () => {
    const refs = scanReferences(root);
    const fg = refs.find((r) => r.package === 'fast-glob')!;
    // `import { escapePath }` — a genuine claim about the module surface
    expect(fg.symbols.get('escapePath')![0]!.via).toBe('named');
    // `import fg from` then `fg.stream()` — a property of the default value
    expect(fg.symbols.get('stream')![0]!.via).toBe('default-member');
  });

  it('treats namespace and CJS member reads as surface claims', () => {
    const refs = scanReferences(root);
    // `import * as pino` — the namespace object IS the module's exports
    expect(refs.find((r) => r.package === 'pino')!.symbols.get('destination')![0]!.via).toBe(
      'namespace',
    );
    const lodash = refs.find((r) => r.package === 'lodash')!;
    expect(lodash.symbols.get('debounce')![0]!.via).toBe('destructured');
    expect(lodash.symbols.get('throttle')![0]!.via).toBe('namespace');
  });

  // `import express, { Request, Response } from 'express'` is correct TS —
  // Request/Response are TYPES, erased before runtime. Counting them as runtime
  // symbols reported a miss on idiomatic code (measured: 40% -> 22.7%).
  it('treats imports used only in type position as type-only', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lurq-typeonly-'));
    try {
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(
        join(dir, 'src/t.ts'),
        `import express, { Request, Response } from 'express';
         import { z } from 'zod';
         import type { Options } from 'ora';
         export const app = express();
         export const h = (req: Request, res: Response) => res.end();
         export const s = z.string();
         export type O = Options;`,
      );
      const refs = scanReferences(dir);
      const ex = refs.find((r) => r.package === 'express')!;
      expect(ex.symbols.get('Request')![0]!.via).toBe('type-only');
      expect(ex.symbols.get('Response')![0]!.via).toBe('type-only');
      // z IS used as a value — still a real runtime claim
      expect(refs.find((r) => r.package === 'zod')!.symbols.get('z')![0]!.via).toBe('named');
      // explicit `import type` is type-only regardless of usage
      expect(refs.find((r) => r.package === 'ora')!.symbols.get('Options')![0]!.via).toBe(
        'type-only',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // `drizzle-orm/pg-core` has its own entry point and its own surface. Scoring
  // its symbols against the drizzle-orm ROOT reported all of them missing.
  it('records the full specifier so subpath imports are not scored against the root', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lurq-subpath-'));
    try {
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(
        join(dir, 'src/db.ts'),
        `import { pgTable, varchar } from 'drizzle-orm/pg-core';
         import { eq } from 'drizzle-orm';
         export const t = pgTable('u', { a: varchar('a') });
         export const w = eq;`,
      );
      const refs = scanReferences(dir).find((r) => r.package === 'drizzle-orm')!;
      expect(refs.symbols.get('pgTable')![0]!.specifier).toBe('drizzle-orm/pg-core');
      expect(refs.symbols.get('eq')![0]!.specifier).toBe('drizzle-orm');
      expect(isRootSpecifier(refs.symbols.get('pgTable')![0]!, 'drizzle-orm')).toBe(false);
      expect(isRootSpecifier(refs.symbols.get('eq')![0]!, 'drizzle-orm')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exposes only surface-claim kinds for scoring', () => {
    expect(SURFACE_CLAIM_KINDS).toEqual(['named', 'destructured', 'namespace']);
    expect(SURFACE_CLAIM_KINDS).not.toContain('default-member');
    // Conditional on the parent's kind, so it is resolved by the scorer rather
    // than accepted here as an unconditional claim.
    expect(SURFACE_CLAIM_KINDS).not.toContain('named-member');
  });

  it('records property reads on a named import, with the parent', () => {
    const zod = scanReferences(root).find((r) => r.package === 'zod')!;
    const str = zod.symbols.get('string')!;
    expect(str[0]!.via).toBe('named-member');
    expect(str[0]!.parent).toBe('z');
    expect(zod.symbols.get('object')![0]!.via).toBe('named-member');
    // `z` itself is still recorded as an ordinary named import.
    expect(zod.symbols.get('z')!.some((r) => r.via === 'named')).toBe(true);
  });

  it('leaves type-position member reads alone', () => {
    // `z.ZodEffects<...>` is a qualified name in a type, erased before runtime,
    // so it asserts nothing about the runtime surface.
    const zod = scanReferences(root).find((r) => r.package === 'zod')!;
    expect(zod.symbols.has('ZodEffects')).toBe(false);
  });
});

describe('arity changes judged at the call site', () => {
  const ref = (calls?: { line: number; args: number | null }[]): SymbolReference => ({
    symbol: 'parse',
    via: 'named',
    specifier: 'cookie',
    file: 'src/a.ts',
    line: 1,
    ...(calls ? { calls } : {}),
  });

  it('breaks a call that no longer passes enough arguments', () => {
    const judged = judgeCalls({ path: 'parse', from: 1, to: 2, fromMax: 2, toMax: 2 }, [
      ref([
        { line: 4, args: 1 },
        { line: 5, args: 2 },
      ]),
    ]);
    expect(judged).toEqual({ broken: [{ file: 'src/a.ts', line: 4, args: 1 }], unmeasured: [] });
  });

  it('breaks a call that passes an argument the new version dropped', () => {
    const judged = judgeCalls({ path: 'parse', from: 1, to: 1, fromMax: 2, toMax: 1 }, [
      ref([
        { line: 3, args: 2 },
        { line: 4, args: 1 },
      ]),
    ]);
    expect(judged!.broken).toEqual([{ file: 'src/a.ts', line: 3, args: 2 }]);
  });

  it('does not blame the upgrade for a call that was already wrong', () => {
    const judged = judgeCalls({ path: 'parse', from: 2, to: 3 }, [ref([{ line: 3, args: 1 }])]);
    expect(judged!.broken).toEqual([]);
  });

  // A spread or a callback is a use nobody counted. Calling it safe is the
  // failure `unverified` exists to prevent.
  it('keeps uncountable uses as unmeasured', () => {
    const judged = judgeCalls({ path: 'parse', from: 1, to: 2 }, [ref([{ line: 6, args: null }])]);
    expect(judged).toEqual({ broken: [], unmeasured: [{ file: 'src/a.ts', line: 6 }] });
  });

  it('declines to judge when a use was never followed', () => {
    expect(judgeCalls({ path: 'parse', from: 1, to: 2 }, [ref()])).toBeNull();
  });

  it('prints introduced type errors, and which packages were not type-checked', () => {
    const out = formatUpgradeReport({
      safe: false,
      breaking: [
        {
          package: 'cookie',
          fromVersion: '1.1.1',
          toVersion: '2.0.1',
          severity: 'warning',
          symbolsRemoved: [],
          arityChanged: [],
          newExports: [],
          typeErrors: [
            {
              file: 'src/session.ts',
              line: 12,
              code: 2353,
              message: "Object literal may only specify known properties, and 'decode' does not exist in type 'ParseOptions'.",
            },
          ],
        },
      ],
      ok: [],
      unverified: [],
      types: [
        { package: 'cookie', checked: true, files: 3 },
        { package: 'left-pad', checked: false, reason: 'the new version ships no type definitions of its own' },
      ],
    });
    expect(out).toContain('src/session.ts:12  TS2353');
    expect(out).toContain('TYPES     checked 1 package(s)');
    expect(out).toContain('left-pad: the new version ships no type definitions of its own');
  });

  it('prints withdrawn entry points and require() breaks', () => {
    const out = formatUpgradeReport({
      safe: false,
      breaking: [
        {
          package: 'chalk',
          fromVersion: '4.1.2',
          toVersion: '5.4.1',
          severity: 'blocking',
          symbolsRemoved: [],
          arityChanged: [],
          newExports: [],
          entriesRemoved: [
            { specifier: 'chalk/source/util', refs: [{ symbol: 'x', via: 'named' as const, specifier: 'chalk/source/util', file: 'src/a.js', line: 2 }] },
          ],
          moduleFormat: {
            from: 'cjs',
            to: 'esm',
            broken: [{ file: 'src/log.js', line: 3, why: '`red` is not an export of the ES module, so it reads as undefined' }],
            olderNode: [{ file: 'src/log.js', line: 1 }],
          },
          requirements: [{ kind: 'engines', name: 'node', needs: '>=18', has: '>=14 (package.json engines)' }],
        },
      ],
      ok: [],
      unverified: [],
    });
    expect(out).toContain('Removes entry point chalk/source/util');
    expect(out).toContain("require('chalk') now loads an ES module (was CommonJS)");
    expect(out).toContain('src/log.js:3  `red` is not an export');
    expect(out).toContain('ERR_REQUIRE_ESM on Node before 20.19 / 22.12: src/log.js:1');
    expect(out).toContain('Requires node >=18; this project has >=14 (package.json engines)');
  });

  it('prints the broken calls and their argument counts', () => {
    const out = formatUpgradeReport({
      safe: false,
      breaking: [
        {
          package: 'pino',
          fromVersion: '8.0.0',
          toVersion: '9.0.0',
          severity: 'warning',
          symbolsRemoved: [],
          arityChanged: [
            {
              symbol: 'child',
              from: 1,
              to: 2,
              refs: [ref([{ line: 31, args: 1 }])],
              callsBroken: [{ file: 'src/log.ts', line: 31, args: 1 }],
              unmeasured: [{ file: 'src/log.ts', line: 40 }],
            },
          ],
          newExports: [],
        },
      ],
      ok: [],
      unverified: [],
    });
    expect(out).toContain('src/log.ts:31 passes 1');
    expect(out).toContain('not countable (spread, or passed as a value): src/log.ts:40');
  });
});

// The money path: a wrong `true` here is a BLOCKING result on correct code.
describe('namespace-member claims', () => {
  const ref = (over: Partial<SymbolReference> = {}): SymbolReference => ({
    symbol: 'string',
    via: 'named-member',
    parent: 'z',
    specifier: 'zod',
    file: 'src/a.ts',
    line: 1,
    ...over,
  });

  it('accepts a member of an object export present in both versions', () => {
    expect(isNamespaceMemberClaim(ref(), new Set(['z']), new Set(['z']))).toBe(true);
  });

  it('rejects a parent that is not an object export', () => {
    // `vi.fn()`: vitest exports `vi`, but not as a plain object, so `fn` says
    // nothing about vitest's own export surface.
    expect(isNamespaceMemberClaim(ref({ parent: 'vi' }), new Set(), new Set())).toBe(false);
  });

  it('rejects when the parent stopped being an object export', () => {
    expect(isNamespaceMemberClaim(ref(), new Set(['z']), new Set())).toBe(false);
  });

  it('rejects any other reference kind', () => {
    expect(isNamespaceMemberClaim(ref({ via: 'named' }), new Set(['z']), new Set(['z']))).toBe(
      false,
    );
    expect(
      isNamespaceMemberClaim(ref({ via: 'default-member', parent: undefined }), new Set(['z']), new Set(['z'])),
    ).toBe(false);
  });
});

describe('upgrade report formatting', () => {
  const report: UpgradeReport = {
    safe: false,
    breaking: [
      {
        package: 'fast-glob',
        fromVersion: '3.2.11',
        toVersion: '3.4.0',
        severity: 'blocking',
        symbolsRemoved: [
          { symbol: 'escapePath', refs: [{ symbol: 'escapePath', via: 'named' as const, specifier: 'fast-glob', file: 'src/util/paths.ts', line: 14 }] },
        ],
        arityChanged: [],
        newExports: [
          { symbol: 'convertPathToPattern', kind: 'function' as const, arity: 1 },
          { symbol: 'GLOB_DEFAULTS', kind: 'object' as const, arity: null },
        ],
      },
      {
        package: 'pino',
        fromVersion: '8.15.0',
        toVersion: '8.21.0',
        severity: 'warning',
        symbolsRemoved: [],
        arityChanged: [{ symbol: 'child', from: 1, to: 2, refs: [{ symbol: 'child', via: 'named' as const, specifier: 'pino', file: 'src/log.ts', line: 31 }] }],
        newExports: [{ symbol: 'multistream', kind: 'function' as const, arity: 2 }],
      },
    ],
    ok: ['semver', 'zod'],
    unverified: [{ package: 'weird-pkg', reason: 'no readable surface' }],
  };

  it('names the file and line for every removed symbol', () => {
    const out = formatUpgradeReport(report);
    expect(out).toContain('BLOCKING');
    expect(out).toContain('src/util/paths.ts:14');
    expect(out).toContain('escapePath');
  });

  it('reports arity changes as warnings rather than blockers', () => {
    const out = formatUpgradeReport(report);
    expect(out).toMatch(/WARNING\s+pino/);
    expect(out).toContain('1 → 2 params');
  });

  // The agent that rewrites call sites has no network tool, so the brief is its
  // only verified source for what replaced a removed export. Without this it can
  // only recall the new API from training data — the exact failure lurq exists
  // to correct.
  it('names candidate replacements next to what was removed', () => {
    const out = formatUpgradeReport(report);
    expect(out).toContain('candidate replacements');
    expect(out).toContain('convertPathToPattern');
  });

  it('offers no candidates where nothing was removed to replace', () => {
    // pino only changed an arity. There is no missing symbol to substitute, and
    // listing unrelated new exports there would read as a suggested edit.
    const out = formatUpgradeReport(report);
    expect(out).not.toContain('multistream');
  });

  // The report's reason to exist: "you call x at line 239, and it is now y".
  it('prints a proven rename at the call site instead of a candidate list', () => {
    const out = formatUpgradeReport({
      safe: false,
      breaking: [
        {
          package: 'cookie',
          fromVersion: '1.1.1',
          toVersion: '2.0.1',
          severity: 'blocking',
          symbolsRemoved: [
            {
              symbol: 'parse',
              renamedTo: ['parseCookie'],
              refs: [{ symbol: 'parse', via: 'named' as const, specifier: 'cookie', file: 'src/session.ts', line: 239 }],
            },
          ],
          arityChanged: [],
          newExports: [{ symbol: 'parseSetCookie', kind: 'function' as const, arity: 2 }],
        },
      ],
      ok: [],
      unverified: [],
    });
    expect(out).toMatch(/cookie\.parse → parseCookie\s+src\/session\.ts:239/);
    expect(out).not.toContain('candidate replacements');
  });

  // A check that says "safe" when it simply did not look is worse than no check.
  it('never folds unverified packages into OK', () => {
    const out = formatUpgradeReport(report);
    expect(out).toContain('NOT declared safe');
    expect(out).toContain('weird-pkg');
  });

  it('safe requires both no breakage AND nothing unchecked', () => {
    expect(report.safe).toBe(false);
    const clean: UpgradeReport = { safe: true, breaking: [], ok: ['a'], unverified: [] };
    expect(formatUpgradeReport(clean)).toContain('No referenced symbols are removed');
  });
});

/**
 * Build output is not source. SKIP_DIRS is a fixed list of names, so a bundler
 * writing anywhere else gets walked: lurq's own tsup target is `dist-operator`,
 * and scanning this repo cited `dist-operator/chunk-OX3TLAEA.js:12` — a
 * generated file, and a line nobody can act on. Asking git which files the
 * project calls its own is exact where a name list can only guess, and guessing
 * the other way (excluding `lib` or `es`) would silently drop real code, which
 * turns a blocking upgrade into a clean one.
 */
describe('source discovery ignores generated output', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lurq-gitscan-'));
    mkdirSync(join(dir, 'src'), { recursive: true });
    mkdirSync(join(dir, 'dist-operator'), { recursive: true });
    writeFileSync(join(dir, 'src', 'real.ts'), `import { eq } from 'drizzle-orm';\neq(1, 2);\n`);
    // Same references, compiled — identical symbols, useless citations.
    writeFileSync(
      join(dir, 'dist-operator', 'chunk-AAAA.js'),
      `import { eq } from 'drizzle-orm';\neq(1, 2);\n`,
    );
    writeFileSync(join(dir, '.gitignore'), 'dist-operator/\n');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('skips a gitignored build directory the name list does not know', () => {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    const refs = scanReferences(dir).find((r) => r.package === 'drizzle-orm');
    const files = (refs?.symbols.get('eq') ?? []).map((r) => r.file);
    expect(files).toContain('src/real.ts');
    expect(files.some((f) => f.startsWith('dist-operator'))).toBe(false);
  });

  it('still scans a directory that is not a git checkout', () => {
    const refs = scanReferences(dir).find((r) => r.package === 'drizzle-orm');
    expect((refs?.symbols.get('eq') ?? []).length).toBeGreaterThan(0);
  });
});
