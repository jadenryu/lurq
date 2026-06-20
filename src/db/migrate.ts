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

async function ensureVectorExtension(handle: DbHandle): Promise<void> {
  await handle.sql`CREATE EXTENSION IF NOT EXISTS vector`;
}

export async function runMigrate(): Promise<void> {
  // A single, non-pooled connection is best for migrations.
  const handle = createDb({ max: 1 });
  try {
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
  const handle = createDb({ max: 1 });
  try {
    logger.warn('Dropping schema `public` (destructive)…');
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
