/**
 * The stack-resolution cache (§4C, revised).
 *
 * A compat answer is a fact about an exact set of `name@version`, so the cache
 * key is the whole set — not its pairs. There is no partial-credit read: a
 * partial answer about a stack is what `likely` used to be, and it is what this
 * replaces.
 *
 * Because the key pins versions, entries never go *wrong*, only unused. That is
 * why the only eviction here is an age sweep, and why a publish needs no hook —
 * see the notes on `invalidateStacksFor` and `pruneStackResolutions`.
 */
import { eq, sql } from 'drizzle-orm';
import type { Database } from './client';
import { stackResolutions } from './schema';
import type { StackResolutionRow } from './schema';

/** A member under check: the exact version the verdict is about. */
export interface StackMember {
  name: string;
  version: string;
}

/**
 * Canonical cache key for a set of pinned members, order-independent.
 *
 * Versions are part of the key, not metadata beside it. An answer about
 * react@18 + next@14 is not an answer about react@19 + next@16 — that is the
 * same discipline `edgeMatchesVersions` enforced on the old pairwise reads, kept
 * here where it costs one sort instead of a post-filter over fetched rows.
 */
export function stackKey(members: StackMember[]): string {
  return [...members]
    .map((m) => `${m.name}@${m.version}`)
    .sort()
    .join('|');
}

/** The cached verdict for this exact set, or null if we have never resolved it. */
export async function getStackResolution(
  db: Database,
  key: string,
): Promise<StackResolutionRow | null> {
  const [row] = await db
    .select()
    .from(stackResolutions)
    .where(eq(stackResolutions.setKey, key))
    .limit(1);
  return row ?? null;
}

/**
 * Persist a *definitive* verdict — resolved, or a proven ERESOLVE conflict.
 *
 * Never call this for a timeout or a network failure. Those are inconclusive,
 * and a cached inconclusive is worse than no cache at all: it turns a transient
 * blip into a permanent wrong answer for that stack, with nothing to evict it.
 *
 * Upserts rather than inserts because two concurrent asks for the same cold
 * stack will both resolve before either writes; the second is the same verdict
 * about the same immutable versions, so last-write-wins is correct and cheap.
 */
export async function recordStackResolution(
  db: Database,
  entry: {
    members: StackMember[];
    resolved: boolean;
    reason?: 'ERESOLVE' | null;
    detail?: string | null;
  },
): Promise<void> {
  const key = stackKey(entry.members);
  await db
    .insert(stackResolutions)
    .values({
      setKey: key,
      packages: entry.members,
      names: entry.members.map((m) => m.name),
      resolved: entry.resolved,
      reason: entry.reason ?? null,
      detail: entry.detail ?? null,
      resolvedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: stackResolutions.setKey,
      set: {
        resolved: sql`excluded.resolved`,
        reason: sql`excluded.reason`,
        detail: sql`excluded.detail`,
        resolvedAt: sql`excluded.resolved_at`,
      },
    });
}

/**
 * Drop every cached stack containing this package. One indexed GIN lookup on
 * `names`; returns how many rows went.
 *
 * NOT wired to publishes, and that is deliberate. Because the key pins exact
 * versions, a new release does not make any stored row *wrong* — the answer
 * about react@19.2.7 stays true about react@19.2.7 forever. The next ask simply
 * pins to 19.2.8, produces a different key, misses, and resolves. Stacks
 * auto-upgrade for free, and eager invalidation would only buy the same answer
 * sooner while doubling resolve volume on patch releases.
 *
 * What this is for is the case where a stored row is genuinely *false*: a version
 * unpublished within npm's 72-hour window, or a package pulled for a security
 * advisory. Then the cached verdict describes a version that no longer exists.
 */
export async function invalidateStacksFor(db: Database, packageName: string): Promise<number> {
  const gone = await db
    .delete(stackResolutions)
    .where(sql`${stackResolutions.names} @> ARRAY[${packageName}]::text[]`)
    .returning({ id: stackResolutions.id });
  return gone.length;
}

/**
 * Drop resolutions older than `maxAgeDays`. This is what actually bounds the
 * table, and it is garbage collection rather than invalidation: rows go stale by
 * ceasing to be asked for, not by becoming untrue.
 *
 * Evicting a stack that is still hot costs one resolve on the next ask, roughly
 * once per retention window — which is why a blunt age sweep beats tracking
 * last-read timestamps on every lookup just to be cleverer about it.
 */
export async function pruneStackResolutions(db: Database, maxAgeDays = 90): Promise<number> {
  const gone = await db
    .delete(stackResolutions)
    .where(sql`${stackResolutions.resolvedAt} < now() - make_interval(days => ${maxAgeDays})`)
    .returning({ id: stackResolutions.id });
  return gone.length;
}
