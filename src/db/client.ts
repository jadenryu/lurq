/**
 * Database client factory. Uses postgres.js + Drizzle. Callers own the lifecycle:
 * create, use, then `await close()` (CLI commands are short-lived processes).
 */
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { requireConfig } from '../core/config';
import * as schema from './schema';

export type Database = PostgresJsDatabase<typeof schema>;

export interface DbHandle {
  db: Database;
  /** Underlying postgres.js client, for raw SQL (e.g. CREATE EXTENSION). */
  sql: postgres.Sql;
  /** Close the connection pool. Always call when done. */
  close: () => Promise<void>;
}

export function createDb(opts: { max?: number } = {}): DbHandle {
  const { DATABASE_URL } = requireConfig(['DATABASE_URL']);
  const sql = postgres(DATABASE_URL!, { max: opts.max ?? 10, onnotice: () => {} });
  const db = drizzle(sql, { schema });
  return { db, sql, close: () => sql.end() };
}

export { schema };
