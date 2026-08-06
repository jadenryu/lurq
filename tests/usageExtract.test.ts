/**
 * Surface extraction against the CDN (§4D): resolving a package's types entry
 * and following the `export * from` barrels it defers to, under the bounds a
 * request-path extraction has to respect.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/core/http', async () => {
  const actual = await vi.importActual<typeof import('../src/core/http')>('../src/core/http');
  return { ...actual, httpRequest: vi.fn() };
});

import { dtsCandidates, extractSurface } from '../src/usage/extract';
import { HttpError, httpRequest } from '../src/core/http';

const ROOT = 'https://cdn.jsdelivr.net/npm/pkg@1.0.0/';

/** Files the fake CDN serves. Anything else 404s, as jsDelivr does. */
let files: Record<string, string>;
/** Paths whose fetch fails in a way that leaves the file's existence unknown. */
let unreachable: Set<string>;
/** Every path fetched, in order. */
let fetched: string[];

beforeEach(() => {
  files = {};
  unreachable = new Set();
  fetched = [];
  vi.mocked(httpRequest).mockImplementation(async (url: string) => {
    const path = url.startsWith(ROOT) ? url.slice(ROOT.length) : url;
    fetched.push(path);
    if (unreachable.has(path)) throw new HttpError('gateway timeout', 504, url);
    const data = files[path];
    if (data === undefined) throw new HttpError('not found', 404, url);
    return { status: 200, data, fromCache: false } as never;
  });
});

const manifest = (types: string) => JSON.stringify({ name: 'pkg', version: '1.0.0', types });
const names = (surface: Awaited<ReturnType<typeof extractSurface>>) => surface?.map((s) => s.name);

describe('dtsCandidates', () => {
  it('resolves relative specifiers against the referencing file', () => {
    expect(dtsCandidates('index.d.ts', './lib')).toEqual(['lib.d.ts', 'lib/index.d.ts']);
    expect(dtsCandidates('lib/index.d.ts', './external')).toEqual([
      'lib/external.d.ts',
      'lib/external/index.d.ts',
    ]);
    expect(dtsCandidates('dist/node/index.d.ts', '../shared/types')).toEqual([
      'dist/shared/types.d.ts',
      'dist/shared/types/index.d.ts',
    ]);
  });

  it('maps a JS specifier onto the matching declaration extension', () => {
    expect(dtsCandidates('index.d.ts', './table.js')).toEqual(['table.d.ts']);
    expect(dtsCandidates('index.d.ts', './table.mjs')).toEqual(['table.d.mts']);
    expect(dtsCandidates('index.d.ts', './table.cjs')).toEqual(['table.d.cts']);
    expect(dtsCandidates('index.d.ts', './table.d.ts')).toEqual(['table.d.ts']);
  });

  it('refuses specifiers that are not this package to fetch', () => {
    // Another package entirely — a different version root, and unbounded fan-out.
    expect(dtsCandidates('index.d.ts', 'rollup')).toEqual([]);
    expect(dtsCandidates('index.d.ts', 'node:http')).toEqual([]);
    // Climbing out of the version root.
    expect(dtsCandidates('index.d.ts', '../../etc/passwd')).toEqual([]);
  });
});

describe('extractSurface — following barrels', () => {
  it('merges a chain of re-exporting barrels into one surface', async () => {
    files = {
      'package.json': manifest('./index.d.ts'),
      'index.d.ts': `export * from "./lib";`,
      'lib/index.d.ts': `export * from "./external";\nexport { z };`,
      'lib/external.d.ts': `export * from "./types";\nexport * from "./errors";`,
      'lib/types.d.ts': `export declare function string(): ZodString;`,
      'lib/errors.d.ts': `export declare class ZodError {}`,
    };

    const surface = await extractSurface('pkg', '1.0.0');

    expect(names(surface)).toEqual(['string', 'z', 'ZodError']);
    // The directory barrel costs one extra round-trip; the sibling guess is
    // tried first because it is the common case.
    expect(fetched).toContain('lib.d.ts');
    expect(fetched).toContain('lib/index.d.ts');
  });

  it('follows the ESM `./x.js` idiom to the declaration beside it', async () => {
    files = {
      'package.json': manifest('./index.d.ts'),
      'index.d.ts': `export * from "./table.js";\nexport * from "./sql/index.js";`,
      'table.d.ts': `export declare function alias(): void;`,
      'sql/index.d.ts': `export declare const and: unknown;`,
    };

    expect(names(await extractSurface('pkg', '1.0.0'))).toEqual(['alias', 'and']);
    // An explicit extension resolves in one fetch — no candidate guessing.
    expect(fetched).not.toContain('table.js');
  });

  it('lets the shallowest definition of a name win', async () => {
    files = {
      'package.json': manifest('./index.d.ts'),
      'index.d.ts': `export * from "./deep";\nexport declare function overlap(a: string): void;`,
      'deep.d.ts': `export declare function overlap(a: number): void;`,
    };

    const surface = await extractSurface('pkg', '1.0.0');
    expect(surface).toEqual([
      { name: 'overlap', kind: 'function', signature: '(a: string): void' },
    ]);
  });

  it('terminates on a cycle between barrels', async () => {
    files = {
      'package.json': manifest('./index.d.ts'),
      'index.d.ts': `export * from "./a";`,
      'a.d.ts': `export * from "./b";\nexport declare const fromA: string;`,
      'b.d.ts': `export * from "./a";\nexport * from "./index";`,
    };

    expect(names(await extractSurface('pkg', '1.0.0'))).toEqual(['fromA']);
    // Each file is fetched at most once, however many barrels point at it.
    expect(new Set(fetched).size).toBe(fetched.length);
  });

  it('keeps walking when a specifier is definitively absent', async () => {
    files = {
      'package.json': manifest('./index.d.ts'),
      // A stale specifier the package no longer ships: both candidates 404.
      'index.d.ts': `export * from "./gone";\nexport * from "./real";`,
      'real.d.ts': `export declare function kept(): void;`,
    };

    expect(names(await extractSurface('pkg', '1.0.0'))).toEqual(['kept']);
  });

  it('degrades to null rather than storing a surface a failed fetch truncated', async () => {
    files = {
      'package.json': manifest('./index.d.ts'),
      'index.d.ts': `export * from "./a";\nexport * from "./b";`,
      'a.d.ts': `export declare function fromA(): void;`,
      'b.d.ts': `export declare function fromB(): void;`,
    };
    unreachable.add('b.d.ts');

    // Half a surface, cached forever, would read as "fromB was removed".
    expect(await extractSurface('pkg', '1.0.0')).toBeNull();
  });

  it('still answers when the entry itself needs no barrel walk', async () => {
    files = {
      'package.json': manifest('./index.d.ts'),
      'index.d.ts': `export declare function connect(): void;`,
    };

    expect(names(await extractSurface('pkg', '1.0.0'))).toEqual(['connect']);
    expect(fetched).toEqual(['package.json', 'index.d.ts']);
  });
});

describe('extractSurface — bounds', () => {
  /** A chain `index → l0 → l1 → …`, each level declaring one symbol. */
  const chain = (depth: number) => {
    const out: Record<string, string> = {
      'package.json': manifest('./index.d.ts'),
      'index.d.ts': `export * from "./l0";`,
    };
    for (let i = 0; i < depth; i++) {
      out[`l${i}.d.ts`] =
        `export declare function at${i}(): void;` +
        (i + 1 < depth ? `\nexport * from "./l${i + 1}";` : '');
    }
    return out;
  };

  it('stops following after a bounded number of hops', async () => {
    files = chain(6);

    const surface = await extractSurface('pkg', '1.0.0');

    // Three hops past the entry, then it stops — deterministically, so the
    // truncation is the same on every extraction and safe to cache.
    expect(names(surface)).toEqual(['at0', 'at1', 'at2']);
    expect(fetched).not.toContain('l3.d.ts');
  });

  it('bounds the total files one extraction may fetch', async () => {
    const wide: Record<string, string> = {
      'package.json': manifest('./index.d.ts'),
      'index.d.ts': Array.from({ length: 40 }, (_, i) => `export * from "./m${i}.js";`).join('\n'),
    };
    for (let i = 0; i < 40; i++) wide[`m${i}.d.ts`] = `export declare function fn${i}(): void;`;
    files = wide;

    const surface = await extractSurface('pkg', '1.0.0');

    expect(surface?.length).toBeGreaterThan(0);
    // package.json + entry + at most the file cap.
    expect(fetched.length).toBeLessThanOrEqual(2 + 24);
  });

  it('issues a hop’s fetches in parallel, so cost scales with depth not width', async () => {
    const wide: Record<string, string> = {
      'package.json': manifest('./index.d.ts'),
      'index.d.ts': Array.from({ length: 8 }, (_, i) => `export * from "./m${i}.js";`).join('\n'),
    };
    for (let i = 0; i < 8; i++) wide[`m${i}.d.ts`] = `export declare function fn${i}(): void;`;
    files = wide;

    let concurrent = 0;
    let peak = 0;
    const serve = vi.mocked(httpRequest).getMockImplementation()!;
    vi.mocked(httpRequest).mockImplementation(async (url: string, opts) => {
      peak = Math.max(peak, ++concurrent);
      try {
        return await serve(url, opts);
      } finally {
        concurrent--;
      }
    });

    await extractSurface('pkg', '1.0.0');
    expect(peak).toBeGreaterThan(1);
  });
});
