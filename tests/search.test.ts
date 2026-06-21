import { describe, it, expect } from 'vitest';
import {
  localEmbed,
  buildEmbeddingText,
  LocalEmbeddingProvider,
} from '../src/search/embeddings';
import { inferCategory } from '../src/search/categoryInference';
import { EMBEDDING_DIM } from '../src/core/constants';

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

  it('returns null when uncertain', () => {
    expect(inferCategory('something completely unrelated to software xyz')).toBeNull();
  });
});
