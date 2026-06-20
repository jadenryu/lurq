/** Static identifiers shared across the CLI and MCP server. */
export const SERVER_NAME = 'lurq';
export const VERSION = '0.1.0';

/** Embedding vector dimensionality (OpenAI text-embedding-3-small). The local
 *  fallback embedder produces vectors of the same length so the DB column and
 *  pgvector index never need to change. */
export const EMBEDDING_DIM = 1536;

/** A package row is flagged `stale: true` in tool responses once its data is
 *  older than this (§17). */
export const STALENESS_DAYS = 7;
