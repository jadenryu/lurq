/**
 * Load the curated seed list (§16) into `seed_packages`. Idempotent: re-running
 * upserts category and leaves `added_at` intact for existing rows.
 */
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { CATEGORIES, type Category } from '../core/types';
import { logger } from '../core/logger';
import { seedJsonPath } from '../core/paths';
import type { Database } from './client';
import { seedPackages } from './schema';

const SeedEntrySchema = z.object({
  name: z.string().min(1),
  category: z.enum(CATEGORIES as unknown as [Category, ...Category[]]).optional(),
});
const SeedFileSchema = z.array(SeedEntrySchema);

export interface SeedEntry {
  name: string;
  category?: Category;
}

export function loadSeedFile(path = seedJsonPath()): SeedEntry[] {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const parsed = SeedFileSchema.parse(raw);
  // De-duplicate by name (first occurrence wins) so a package can't be seeded twice.
  const byName = new Map<string, SeedEntry>();
  for (const entry of parsed) {
    if (!byName.has(entry.name)) byName.set(entry.name, entry);
  }
  return [...byName.values()];
}

export async function loadSeedPackages(db: Database, path?: string): Promise<number> {
  const entries = loadSeedFile(path);
  if (entries.length === 0) return 0;
  await db
    .insert(seedPackages)
    .values(entries.map((e) => ({ name: e.name, category: e.category ?? null })))
    .onConflictDoUpdate({
      target: seedPackages.name,
      // Refresh category to the incoming value on conflict (EXCLUDED.category).
      set: { category: sql`excluded.category` },
    });
  logger.info(`Loaded ${entries.length} packages into seed_packages.`);
  return entries.length;
}
