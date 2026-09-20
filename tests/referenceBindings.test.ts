/**
 * The binding facts a patcher needs from the reference scanner: the local name,
 * whether the import aliases the export, the offsets of the identifier that
 * holds the exported name, and whether the local is shadowed in that file.
 *
 * Written against real files on disk, because the scanner walks a directory and
 * the offsets only mean something against the bytes it read.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scanReferences, type SymbolReference } from '../src/surface/references';

let root: string;

const write = (rel: string, src: string) => {
  const path = join(root, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, src, 'utf8');
  return src;
};

let sources: Record<string, string> = {};
let refs: SymbolReference[] = [];
const find = (symbol: string, file: string) =>
  refs.find((r) => r.symbol === symbol && r.file === file);

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'lurq-refbind-'));
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'fx', dependencies: { cookie: '^1.0.0' } }),
    'utf8',
  );
  sources = {
    'src/bare.ts': write(
      'src/bare.ts',
      `import { parse } from 'cookie';\n\nexport const read = (h: string) => parse(h);\n`,
    ),
    'src/aliased.ts': write(
      'src/aliased.ts',
      `import { parse as readCookie } from 'cookie';\n\nexport const read = (h: string) => readCookie(h);\n`,
    ),
    'src/required.js': write(
      'src/required.js',
      `const { parse } = require('cookie');\n\nmodule.exports = (h) => parse(h);\n`,
    ),
    'src/shadowed.ts': write(
      'src/shadowed.ts',
      `import { parse } from 'cookie';\n\nfunction wrap() {\n  const parse = (h: string) => h;\n  return parse('x');\n}\n\nexport const read = (h: string) => parse(h) ?? wrap();\n`,
    ),
    'src/subpath.ts': write(
      'src/subpath.ts',
      `import { parse } from 'cookie/lib';\n\nexport const read = (h: string) => parse(h);\n`,
    ),
  };
  const scanned = scanReferences(root).find((p) => p.package === 'cookie');
  refs = [...(scanned?.symbols.values() ?? [])].flat();
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

/** The exact text the recorded offsets point at, from the file as written. */
const slice = (ref: SymbolReference) => sources[ref.file]!.slice(ref.nameStart!, ref.nameEnd!);

describe('a bare named import', () => {
  it('records the local name, that it is not aliased, and offsets over the export name', () => {
    const ref = find('parse', 'src/bare.ts')!;
    expect(ref).toMatchObject({
      via: 'named',
      local: 'parse',
      aliased: false,
      specifier: 'cookie',
    });
    expect(slice(ref)).toBe('parse');
    expect(ref.shadowed).toBeUndefined();
  });

  it('gives every use an offset, so a rename can rewrite the call sites', () => {
    const ref = find('parse', 'src/bare.ts')!;
    const uses = ref.calls ?? [];
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(sources['src/bare.ts']!.slice(u.start!, u.end!)).toBe('parse');
  });
});

describe('an aliased import', () => {
  it('points its offsets at the exported name, not the local one', () => {
    const ref = find('parse', 'src/aliased.ts')!;
    expect(ref).toMatchObject({ local: 'readCookie', aliased: true });
    expect(slice(ref)).toBe('parse');
    // The local name is what the call sites read, and a rename of the export leaves it alone.
    for (const u of ref.calls ?? [])
      expect(sources['src/aliased.ts']!.slice(u.start!, u.end!)).toBe('readCookie');
  });
});

describe('a destructured require', () => {
  it('records the same binding facts as an ESM import', () => {
    const ref = find('parse', 'src/required.js')!;
    expect(ref).toMatchObject({
      via: 'destructured',
      local: 'parse',
      aliased: false,
      loader: 'require',
    });
    expect(slice(ref)).toBe('parse');
  });
});

describe('a local that is declared twice', () => {
  it('is marked shadowed, so a patcher refuses the file instead of rewriting the wrong name', () => {
    expect(find('parse', 'src/shadowed.ts')!.shadowed).toBe(true);
  });
});

describe('a subpath import', () => {
  it('keeps its own specifier, so a root-version rename is not applied to it', () => {
    expect(find('parse', 'src/subpath.ts')).toMatchObject({
      specifier: 'cookie/lib',
      local: 'parse',
    });
  });
});
