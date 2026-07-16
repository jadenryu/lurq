/**
 * Schema management for `lurq db migrate` / `lurq db reset`.
 *
 * `migrate` ensures the pgvector extension exists (Drizzle does not create it),
 * applies generated migrations, then loads the curated seed list (§18 M1).
 * `reset` drops the public schema and re-runs migrate — destructive.
 */
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { logger } from '../core/logger';
import { migrationsDir } from '../core/paths';
import { createDb, type DbHandle } from './client';
import { loadSeedPackages } from './seed';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '']);

/** `host/db` for the active DATABASE_URL — logged so the operator always sees
 *  which database a destructive/schema op is about to hit. */
function dbTarget(): { label: string; host: string } {
  try {
    const u = new URL(process.env.DATABASE_URL ?? '');
    return { label: `${u.hostname}${u.pathname}`, host: u.hostname };
  } catch {
    return { label: 'unknown', host: 'unknown' };
  }
}

async function ensureVectorExtension(handle: DbHandle): Promise<void> {
  // Non-fatal: if the extension already exists (it must, once migration 0000's
  // `vector` column is in place) this is a no-op, and a transient hiccup here
  // must NOT abort the migrator and leave later migrations (0001+) unapplied.
  try {
    await handle.sql`CREATE EXTENSION IF NOT EXISTS vector`;
  } catch (err) {
    logger.warn(
      `CREATE EXTENSION vector did not run cleanly (continuing to migrations): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

export async function runMigrate(): Promise<void> {
  // A single, non-pooled connection is best for migrations.
  const handle = createDb({ max: 1 });
  try {
    logger.info(`Target database: ${dbTarget().label}`);
    logger.info('Ensuring pgvector extension…');
    await ensureVectorExtension(handle);

    logger.info('Applying migrations…');
    await migrate(handle.db, { migrationsFolder: migrationsDir() });

    logger.info('Loading seed list…');
    await loadSeedPackages(handle.db);

    logger.info('Migration complete.');
  } finally {
    await handle.close();
  }
}

export async function runReset(): Promise<void> {
  // Hard guard: `reset` DROPs the schema. Refuse anything that isn't a local
  // database unless the operator explicitly opts in — so a `.env` pointed at
  // prod (or a stray LURQ_ENV_FILE) can never be wiped by accident.
  const { label, host } = dbTarget();
  if (!LOCAL_HOSTS.has(host) && process.env.LURQ_ALLOW_REMOTE_RESET !== '1') {
    throw new Error(
      `Refusing to reset a non-local database (${label}). This DROPs the entire schema. ` +
        `If you truly mean to wipe it, re-run with LURQ_ALLOW_REMOTE_RESET=1.`,
    );
  }

  const handle = createDb({ max: 1 });
  try {
    logger.warn(`Dropping schema \`public\` on ${label} (destructive)…`);
    await handle.sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    // Drizzle tracks applied migrations in its own schema; clear it too.
    await handle.sql`DROP SCHEMA IF EXISTS drizzle CASCADE`;
  } finally {
    await handle.close();
  }
  // Re-apply everything from scratch.
  await runMigrate();
  logger.info('Reset complete.');
}
