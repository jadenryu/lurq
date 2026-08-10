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

/**
 * Server-side ceiling on a single query, in milliseconds.
 *
 * Without one, a query that never returns holds its connection forever. The
 * hosted server runs a pool of 20 against arbitrary user input, so a handful of
 * those is the whole pool gone and every later request queueing behind them —
 * an outage that looks like a hang rather than an error, and that a restart is
 * the only cure for. Postgres cancels past this and the driver raises, which
 * the route's own try/catch already turns into a 500.
 *
 * Generous on purpose: the slowest legitimate query here is the hybrid
 * vector+lexical search, and this is a backstop against pathology, not a
 * performance budget.
 */
const STATEMENT_TIMEOUT_MS = 15_000;

export function createDb(opts: { max?: number } = {}): DbHandle {
  const { DATABASE_URL } = requireConfig(['DATABASE_URL']);
  const sql = postgres(DATABASE_URL!, {
    max: opts.max ?? 10,
    onnotice: () => {},
    connection: { statement_timeout: STATEMENT_TIMEOUT_MS },
  });
  const db = drizzle(sql, { schema });
  return { db, sql, close: () => sql.end() };
}

export { schema };
