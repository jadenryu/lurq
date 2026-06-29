/**
 * Cursor persistence for the npm `_changes` follower (one row per feed in
 * `watch_state`), so a restart resumes from the last processed sequence instead
 * of replaying the registry from the beginning.
 */
import { eq } from 'drizzle-orm';
import type { Database } from './client';
import { watchState } from './schema';

export async function getWatchCursor(db: Database, id: string): Promise<string | null> {
  const rows = await db
    .select({ seq: watchState.seq })
    .from(watchState)
    .where(eq(watchState.id, id))
    .limit(1);
  return rows[0]?.seq ?? null;
}

export async function setWatchCursor(db: Database, id: string, seq: string): Promise<void> {
  await db
    .insert(watchState)
    .values({ id, seq, updatedAt: new Date() })
    .onConflictDoUpdate({ target: watchState.id, set: { seq, updatedAt: new Date() } });
}
