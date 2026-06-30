import { describe, it, expect } from 'vitest';
import {
  localEmbed,
  buildEmbeddingText,
  LocalEmbeddingProvider,
} from '../src/search/embeddings';
import { inferCategory, inferCategoryFromSignals } from '../src/search/categoryInference';
import { rrfFuse } from '../src/search/recommend';
import { EMBEDDING_DIM } from '../src/core/constants';
import type { RawPackageSignals } from '../src/ingestion/types';

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot; // both are unit vectors
}

describe('local embedder', () => {
  it('produces deterministic unit vectors of the right length', () => {
    const a = localEmbed('react form library');
    const b = localEmbed('react form library');
    expect(a).toHaveLength(EMBEDDING_DIM);
    expect(a).toEqual(b);
    expect(cosine(a, a)).toBeCloseTo(1, 5);
  });

  it('scores lexically-similar texts higher than unrelated ones', () => {
    const need = localEmbed('a library for handling forms in react');
    const forms = localEmbed('react hook form: performant forms library for react');
    const dates = localEmbed('parse and format dates and timezones');
    expect(cosine(need, forms)).toBeGreaterThan(cosine(need, dates));
  });

  it('provider embeds a batch', async () => {
    const vectors = await new LocalEmbeddingProvider().embed(['one', 'two']);
    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toHaveLength(EMBEDDING_DIM);
  });
});

describe('buildEmbeddingText', () => {
  it('combines name, category, and summary/description', () => {
    expect(
      buildEmbeddingText({ name: 'zod', category: 'validation', summary: 'schema validation', description: null }),
    ).toBe('zod. validation. schema validation');
    expect(
      buildEmbeddingText({ name: 'zod', category: 'validation', summary: null, description: 'fallback desc' }),
    ).toBe('zod. validation. fallback desc');
  });
});

describe('category inference', () => {
  it('maps common needs to the right category', () => {
    expect(inferCategory('a form library for react')).toBe('forms');
    expect(inferCategory('validate a schema and parse input')).toBe('validation');
    expect(inferCategory('an ORM for postgres')).toBe('orm');
    expect(inferCategory('format dates and timezones')).toBe('date-time');
    expect(inferCategory('debounce a function')).toBe('utility');
    expect(inferCategory('http client to call an API')).toBe('http-client');
  });

  it('routes "date formatting" to date-time, not linting (first-match precedence)', () => {
    expect(inferCategory('date formatting')).toBe('date-time');
    // a bare formatting/linting need still resolves to linting
    expect(inferCategory('a code formatting tool')).toBe('linting');
  });

  it('returns null when uncertain', () => {
    expect(inferCategory('something completely unrelated to software xyz')).toBeNull();
  });
});

describe('rrfFuse (hybrid search §3)', () => {
  const n = (name: string) => ({ name });

  it('ranks a doc both legs agree on above either leg’s top-1', () => {
    // The doc's worked example: drizzle-orm is #3 in vector, #1 in lexical.
    const vector = [n('prisma'), n('typeorm'), n('drizzle-orm'), n('kysely')];
    const lexical = [n('drizzle-orm'), n('drizzle-kit'), n('drizzle-zod')];
    const fused = rrfFuse([vector, lexical]);
    expect(fused[0]!.row.name).toBe('drizzle-orm');
    // It beats prisma, which was #1 in the vector leg but absent from lexical.
    const prisma = fused.find((f) => f.row.name === 'prisma')!;
    expect(fused[0]!.rrf).toBeGreaterThan(prisma.rrf);
  });

  it('sums contributions for docs present in both lists', () => {
    const fused = rrfFuse([[n('a'), n('b')], [n('b'), n('a')]], 60);
    // a: 1/61 + 1/62 ; b: 1/62 + 1/61 — equal, both appear once per list.
    const a = fused.find((f) => f.row.name === 'a')!;
    expect(a.rrf).toBeCloseTo(1 / 61 + 1 / 62, 10);
  });

  it('falls back to a single list’s order when the other is empty', () => {
    const fused = rrfFuse([[n('x'), n('y'), n('z')], []]);
    expect(fused.map((f) => f.row.name)).toEqual(['x', 'y', 'z']);
  });
});

describe('inferCategoryFromSignals (categorize-on-ingest §2A)', () => {
  function signals(over: Partial<RawPackageSignals['registry']> & { name?: string } = {}): RawPackageSignals {
    const { name = 'pkg', ...reg } = over;
    return {
      name,
      registry: {
        name,
        description: null,
        latestVersion: '1.0.0',
        license: 'MIT',
        homepage: null,
        repo: null,
        repoUrl: null,
        firstPublishedAt: null,
        lastReleaseAt: null,
        deprecated: false,
        maintainersCount: 1,
        readme: null,
        keywords: [],
        hasTypes: false,
        hasTestScript: false,
        directDependenciesCount: 0,
        hasProvenance: false,
        hasInstallScripts: false,
        peerDependencies: null,
        peerDependenciesMeta: null,
        engines: null,
        versionTimeline: [],
        ...reg,
      },
      downloads: null,
      github: null,
      depsDev: null,
      bundle: null,
      errors: [],
    };
  }

  it('classifies from keywords and description, not a query', () => {
    expect(
      inferCategoryFromSignals(signals({ name: 'superorm', keywords: ['orm', 'query builder'] })),
    ).toBe('orm');
    expect(
      inferCategoryFromSignals(signals({ description: 'a validation library for parsing input schemas' })),
    ).toBe('validation');
  });

  it('returns null when nothing matches', () => {
    expect(inferCategoryFromSignals(signals({ description: 'zzz qqq vvv' }))).toBeNull();
  });
});
