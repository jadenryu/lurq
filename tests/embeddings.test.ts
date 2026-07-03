import { describe, it, expect } from 'vitest';
import { OpenAIEmbeddingProvider } from '../src/search/embeddings';
import { EMBEDDING_DIM } from '../src/core/constants';

function fakeFetch(embedding: number[]): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ data: [{ embedding, index: 0 }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
}

describe('OpenAIEmbeddingProvider dimension guard', () => {
  it('accepts vectors of the expected width', async () => {
    const p = new OpenAIEmbeddingProvider('k', 'text-embedding-3-small', fakeFetch(
      new Array(EMBEDDING_DIM).fill(0.01),
    ));
    const [v] = await p.embed(['accepts correct-width vector']);
    expect(v).toHaveLength(EMBEDDING_DIM);
  });

  it('throws on a wrong-dimension vector instead of storing garbage', async () => {
    const p = new OpenAIEmbeddingProvider('k', 'text-embedding-3-large', fakeFetch([0.1, 0.2, 0.3]));
    await expect(p.embed(['rejects wrong-width vector'])).rejects.toThrow(/expected 1536/i);
  });
});
