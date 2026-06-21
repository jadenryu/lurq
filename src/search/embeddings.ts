/**
 * Embedding providers (§11). A pluggable interface with two implementations:
 *  - OpenAI (`text-embedding-3-small`, 1536-dim) — the default when a key is set.
 *  - Local deterministic embedder (no key) — a hashing bag-of-words that captures
 *    lexical overlap. Crude but real: it makes `recommend` and tests work with
 *    zero credentials (R1 decision). Both emit EMBEDDING_DIM-length unit vectors,
 *    so the DB column and pgvector index never change.
 */
import { createHash } from 'node:crypto';
import { getConfig } from '../core/config';
import { EMBEDDING_DIM } from '../core/constants';
import { httpRequest } from '../core/http';
import { logger } from '../core/logger';
import type { Category } from '../core/types';

export interface EmbeddingProvider {
  readonly kind: 'openai' | 'local';
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

/** Normalized text blob embedded per package (§8.2). */
export function buildEmbeddingText(input: {
  name: string;
  category: Category | null;
  summary: string | null;
  description: string | null;
}): string {
  const body = input.summary || input.description || '';
  return `${input.name}. ${input.category ?? ''}. ${body}`.trim();
}

// ── Local deterministic embedder ────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

/** FNV-1a 32-bit hash. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function localEmbed(text: string, dim = EMBEDDING_DIM): number[] {
  const vec = new Float64Array(dim);
  const tokens = tokenize(text);
  const add = (token: string, weight: number) => {
    const idx = fnv1a(token) % dim;
    const sign = fnv1a('s:' + token) & 1 ? 1 : -1;
    vec[idx]! += weight * sign;
  };
  for (const t of tokens) add(t, 1);
  for (let i = 0; i < tokens.length - 1; i++) add(`${tokens[i]} ${tokens[i + 1]}`, 0.5);

  // L2-normalize to a unit vector (cosine-friendly).
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += vec[i]! * vec[i]!;
  norm = Math.sqrt(norm) || 1;
  const out = new Array<number>(dim);
  for (let i = 0; i < dim; i++) out[i] = vec[i]! / norm;
  return out;
}

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly kind = 'local' as const;
  readonly dimensions = EMBEDDING_DIM;
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => localEmbed(t));
  }
}

// ── OpenAI embedder ─────────────────────────────────────────────────────────

const OPENAI_BATCH = 96;

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly kind = 'openai' as const;
  readonly dimensions = EMBEDDING_DIM;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetchImpl?: typeof fetch,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += OPENAI_BATCH) {
      const batch = texts.slice(i, i + OPENAI_BATCH);
      const body = JSON.stringify({ model: this.model, input: batch });
      const { data } = await httpRequest<any>('https://api.openai.com/v1/embeddings', {
        host: 'api.openai.com',
        method: 'POST',
        ttlMs: 30 * 24 * 60 * 60 * 1000, // cache embeddings 30d to control cost
        cacheKey: `openai-embed ${this.model} ${createHash('sha256').update(body).digest('hex')}`,
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body,
        fetchImpl: this.fetchImpl,
      });
      const vectors: { embedding: number[]; index: number }[] = data?.data ?? [];
      vectors.sort((a, b) => a.index - b.index);
      for (const v of vectors) out.push(v.embedding);
    }
    return out;
  }
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function createEmbeddingProvider(fetchImpl?: typeof fetch): EmbeddingProvider {
  const config = getConfig();
  if (config.EMBEDDING_PROVIDER === 'openai' && config.EMBEDDING_API_KEY) {
    return new OpenAIEmbeddingProvider(config.EMBEDDING_API_KEY, config.EMBEDDING_MODEL, fetchImpl);
  }
  if (config.EMBEDDING_PROVIDER === 'openai' && !config.EMBEDDING_API_KEY) {
    logger.warn('EMBEDDING_API_KEY not set — falling back to the local embedder.');
  }
  return new LocalEmbeddingProvider();
}
