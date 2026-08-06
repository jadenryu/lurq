import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SURFACE_CLAIM_KINDS, packageOfSpecifier, scanReferences } from '../src/surface/references';
import { formatUpgradeReport, type UpgradeReport } from '../src/surface/upgrade';

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

  it('exposes only surface-claim kinds for scoring', () => {
    expect(SURFACE_CLAIM_KINDS).toEqual(['named', 'destructured', 'namespace']);
    expect(SURFACE_CLAIM_KINDS).not.toContain('default-member');
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
          { symbol: 'escapePath', refs: [{ symbol: 'escapePath', via: 'named' as const, file: 'src/util/paths.ts', line: 14 }] },
        ],
        arityChanged: [],
      },
      {
        package: 'pino',
        fromVersion: '8.15.0',
        toVersion: '8.21.0',
        severity: 'warning',
        symbolsRemoved: [],
        arityChanged: [{ symbol: 'child', from: 1, to: 2, refs: [{ symbol: 'child', via: 'named' as const, file: 'src/log.ts', line: 31 }] }],
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
