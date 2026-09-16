/**
 * The rename codemod, over references scanned from real files so the offsets are
 * genuine, and applied so the assertions are about resulting source text rather
 * than about edit bookkeeping.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renameFindings } from '../src/fix/rename';
import { applyEdits, editsByFile, type Finding } from '../src/fix/types';
import { scanReferences, type SymbolReference } from '../src/surface/references';
import type { BreakingFinding } from '../src/surface/upgrade';

let root: string;
let refs: SymbolReference[] = [];

const write = (rel: string, src: string) => {
  const path = join(root, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, src, 'utf8');
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'lurq-rename-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fx', dependencies: { cookie: '^1.0.0' } }), 'utf8');
  write('src/bare.ts', `import { parse } from 'cookie';\n\nexport const read = (h: string) => parse(h);\nexport const both = (h: string) => parse(h, {});\n`);
  write('src/aliased.ts', `import { parse as readCookie } from 'cookie';\n\nexport const read = (h: string) => readCookie(h);\n`);
  write('src/shadowed.ts', `import { parse } from 'cookie';\n\nexport function wrap(h: string) {\n  const parse = (s: string) => s;\n  return parse(h);\n}\nexport const read = (h: string) => parse(h);\n`);
  write('src/subpath.ts', `import { parse } from 'cookie/lib';\n\nexport const read = (h: string) => parse(h);\n`);
  write('src/ns.ts', `import * as cookie from 'cookie';\n\nexport const read = (h: string) => cookie.parse(h);\n`);
  const scanned = scanReferences(root).find((p) => p.package === 'cookie');
  refs = [...(scanned?.symbols.values() ?? [])].flat();
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const source = (file: string) => readFileSync(join(root, file), 'utf8');
const refsIn = (...files: string[]) => refs.filter((r) => files.includes(r.file) && r.symbol === 'parse');

function breaking(over: Partial<BreakingFinding> & { symbolsRemoved: BreakingFinding['symbolsRemoved'] }): BreakingFinding {
  return {
    package: 'cookie',
    fromVersion: '0.6.0',
    toVersion: '1.0.0',
    severity: 'blocking',
    arityChanged: [],
    newExports: [],
    ...over,
  };
}

const plan = (removed: BreakingFinding['symbolsRemoved']) =>
  renameFindings(breaking({ symbolsRemoved: removed }), { packageName: 'cookie' });

/** Apply one finding's edits to the files they name, returning the new text. */
function applied(finding: Finding): Record<string, string> {
  return Object.fromEntries(
    [...editsByFile([finding])].map(([file, edits]) => [file, applyEdits(source(file), edits)]),
  );
}

describe('a proven single-candidate rename', () => {
  it('rewrites a bare import and every use of it', () => {
    const { findings, refused } = plan([{ symbol: 'parse', renamedTo: ['parseCookie'], refs: refsIn('src/bare.ts') }]);
    expect(refused).toEqual([]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ domain: 'package', code: 'renamed-export:cookie:parse', severity: 'blocking' });
    expect(findings[0]!.fix!.verify).toEqual(['typecheck', 'tests']);

    const out = applied(findings[0]!)['src/bare.ts']!;
    expect(out).toContain("import { parseCookie } from 'cookie';");
    expect(out).toContain('export const read = (h: string) => parseCookie(h);');
    expect(out).toContain('export const both = (h: string) => parseCookie(h, {});');
    expect(out).not.toContain('parse(h)');
  });

  it('rewrites only the import of an aliased one, because the local name still reads correctly', () => {
    const { findings } = plan([{ symbol: 'parse', renamedTo: ['parseCookie'], refs: refsIn('src/aliased.ts') }]);
    const out = applied(findings[0]!)['src/aliased.ts']!;
    expect(out).toContain("import { parseCookie as readCookie } from 'cookie';");
    expect(out).toContain('=> readCookie(h);');
  });

  it('carries evidence naming the proof, not a similarity guess', () => {
    const { findings } = plan([{ symbol: 'parse', renamedTo: ['parseCookie'], refs: refsIn('src/bare.ts') }]);
    expect(findings[0]!.evidence).toMatch(/exported from one declaration/);
  });
});

describe('what it refuses', () => {
  it('refuses a file where the local name is declared twice', () => {
    const { findings, refused } = plan([{ symbol: 'parse', renamedTo: ['parseCookie'], refs: refsIn('src/shadowed.ts') }]);
    expect(refused[0]!.reason).toMatch(/declared more than once/);
    expect(findings[0]!.fix!.edits).toBeUndefined();
    expect(findings[0]!.fix!.task!.instruction).toMatch(/Rename parse to parseCookie/);
  });

  it('refuses a reference reached as a namespace, where the export name is not what the code writes', () => {
    const nsRefs = refs.filter((r) => r.file === 'src/ns.ts');
    expect(nsRefs.length).toBeGreaterThan(0);
    const { refused } = plan([{ symbol: 'parse', renamedTo: ['parseCookie'], refs: nsRefs }]);
    expect(refused[0]!.reason).toMatch(/reached as namespace/);
  });

  it('leaves a subpath import alone, since a subpath has its own surface', () => {
    const { findings, refused } = plan([{ symbol: 'parse', renamedTo: ['parseCookie'], refs: refsIn('src/subpath.ts') }]);
    expect(refused[0]!.reason).toMatch(/nothing in this project references it at the package root/);
    expect(findings[0]!.fix!.edits).toBeUndefined();
  });

  it('turns more than one surviving name into an agent task, never an edit', () => {
    const { findings, refused } = plan([
      { symbol: 'parse', renamedTo: ['parseCookie', 'parseSetCookie'], refs: refsIn('src/bare.ts') },
    ]);
    expect(refused[0]!.reason).toMatch(/more than one surviving name/);
    const fix = findings[0]!.fix!;
    expect(fix.edits).toBeUndefined();
    expect(fix.task!.evidence[0]).toMatch(/parseCookie, parseSetCookie/);
    expect(fix.task!.files).toEqual(['src/bare.ts']);
  });

  it('refuses a reference with no recorded position', () => {
    const stripped: SymbolReference[] = refsIn('src/bare.ts').map((r) => ({ ...r, nameStart: undefined, nameEnd: undefined }));
    const { refused } = plan([{ symbol: 'parse', renamedTo: ['parseCookie'], refs: stripped }]);
    expect(refused[0]!.reason).toMatch(/no recorded position/);
  });

  it('says nothing when the package neither proves a rename nor ships anything new', () => {
    const { findings, refused } = plan([{ symbol: 'parse', refs: refsIn('src/bare.ts') }]);
    expect(findings).toEqual([]);
    expect(refused).toEqual([]);
  });
});

describe('a removal with no proof, which is most of them', () => {
  const unproven = (over: Partial<BreakingFinding> = {}) =>
    renameFindings(
      breaking({ symbolsRemoved: [{ symbol: 'parse', refs: refsIn('src/bare.ts') }], ...over }),
      { packageName: 'cookie' },
    );

  it('briefs the agent with the target version’s real exports instead of staying silent', () => {
    const { findings } = unproven({
      newExports: [
        { symbol: 'parseCookie', kind: 'function', arity: 2 },
        { symbol: 'parseSetCookie', kind: 'function', arity: 2 },
      ],
    });
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.code).toBe('removed-export:cookie:parse');
    expect(f.fix!.edits).toBeUndefined();
    // The candidates carry their kind and arity: an agent with no network cannot
    // otherwise tell a 2-parameter function from a re-exported type.
    expect(f.fix!.task!.evidence).toEqual([
      'parseCookie: function, 2 parameter(s)',
      'parseSetCookie: function, 2 parameter(s)',
    ]);
    expect(f.fix!.task!.instruction).toMatch(/Do not invent a name/);
    expect(f.fix!.task!.files).toEqual(['src/bare.ts']);
  });

  it('carries the report’s own severity rather than calling everything blocking', () => {
    const { findings } = unproven({
      severity: 'warning',
      newExports: [{ symbol: 'parseCookie', kind: 'function', arity: 2 }],
    });
    expect(findings[0]!.severity).toBe('warning');
  });

  it('caps the candidate list, so the instruction is not buried', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      symbol: `fn${i}`,
      kind: 'function' as const,
      arity: 1,
    }));
    const { findings } = unproven({ newExports: many });
    expect(findings[0]!.fix!.task!.evidence).toHaveLength(20);
  });

  it('stays quiet when nothing in this project uses the removed symbol', () => {
    const { findings } = renameFindings(
      breaking({
        symbolsRemoved: [{ symbol: 'parse', refs: [] }],
        newExports: [{ symbol: 'parseCookie', kind: 'function', arity: 2 }],
      }),
      { packageName: 'cookie' },
    );
    expect(findings).toEqual([]);
  });
});
