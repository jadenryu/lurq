/**
 * API-key generation, hashing, and lifecycle for the hosted HTTP service
 * (docs/lurq-hosted-deployment.md §5). Keys are high-entropy random strings; only
 * their sha256 hash is persisted, so a DB leak never exposes a usable key. The
 * plaintext is returned exactly once (at creation) and never stored or logged.
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { API_KEY_PREFIX } from '../core/constants';
import type { Database } from '../db/client';
import { apiKeys, type ApiKeyRow } from '../db/schema';
import { logger } from '../core/logger';

/** Chars of the random body kept in the display prefix (`lurq_live_<6>`). */
const DISPLAY_BODY = 6;

/** sha256 hex of a key — the only form ever persisted or compared. */
export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export interface GeneratedKey {
  /** The full plaintext key — show once, never store. */
  key: string;
  /** sha256 hash to persist. */
  hash: string;
  /** Identifiable, safe-to-display prefix. */
  prefix: string;
}

export function generateApiKey(): GeneratedKey {
  // 24 random bytes → 32-char base64url body: unbiased, URL/header-safe.
  const body = randomBytes(24).toString('base64url');
  const key = API_KEY_PREFIX + body;
  return { key, hash: hashKey(key), prefix: API_KEY_PREFIX + body.slice(0, DISPLAY_BODY) };
}

export interface CreateKeyInput {
  label?: string;
  tier?: string;
  ownerId?: string;
}

/** Create and persist a key. Returns the plaintext ONCE plus the stored row. */
export async function createKey(
  db: Database,
  input: CreateKeyInput = {},
): Promise<{ key: string; row: ApiKeyRow }> {
  const { key, hash, prefix } = generateApiKey();
  const [row] = await db
    .insert(apiKeys)
    .values({
      keyHash: hash,
      prefix,
      label: input.label,
      tier: input.tier ?? 'free',
      ownerId: input.ownerId,
    })
    .returning();
  return { key, row: row! };
}

/**
 * Look up an active (non-revoked) key by its plaintext form. Returns null if the
 * key is unknown or revoked. Stamps `lastUsedAt` best-effort without blocking.
 */
export async function lookupActiveKey(db: Database, key: string): Promise<ApiKeyRow | null> {
  const hash = hashKey(key);
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)))
    .limit(1);
  if (!row) return null;
  // Fire-and-forget usage stamp; failures must never affect the request, but
  // log at debug so a persistently-failing write isn't completely invisible.
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.id))
    .then(undefined, (err) => logger.debug(`lastUsedAt stamp failed: ${String(err)}`));
  return row;
}

export async function listKeys(db: Database): Promise<ApiKeyRow[]> {
  return db.select().from(apiKeys).orderBy(desc(apiKeys.createdAt));
}

/** Resolve a "prefix or numeric id" argument to a Drizzle equality filter. */
function matchByPrefixOrId(prefixOrId: string) {
  const asId = Number(prefixOrId);
  return Number.isInteger(asId) && String(asId) === prefixOrId.trim()
    ? eq(apiKeys.id, asId)
    : eq(apiKeys.prefix, prefixOrId);
}

/**
 * Revoke a key by display prefix or numeric id. Returns how many active keys were
 * revoked (0 if none matched or it was already revoked).
 */
export async function revokeKey(db: Database, prefixOrId: string): Promise<number> {
  const rows = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(matchByPrefixOrId(prefixOrId), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id });
  return rows.length;
}

/**
 * Rotate ("swap") a key: issue a replacement carrying the old key's label, tier,
 * and owner, then revoke the original. Returns the new plaintext (once), the new
 * row, and the revoked row — or null if no active key matched.
 *
 * The new key is created BEFORE the old one is revoked, so a failure mid-rotation
 * leaves the caller with a working key (at worst two active keys, never zero).
 */
export async function rotateKey(
  db: Database,
  prefixOrId: string,
): Promise<{ key: string; row: ApiKeyRow; previous: ApiKeyRow } | null> {
  const [previous] = await db
    .select()
    .from(apiKeys)
    .where(and(matchByPrefixOrId(prefixOrId), isNull(apiKeys.revokedAt)))
    .limit(1);
  if (!previous) return null;

  const { key, row } = await createKey(db, {
    label: previous.label ?? undefined,
    tier: previous.tier,
    ownerId: previous.ownerId ?? undefined,
  });
  await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, previous.id));
  return { key, row, previous };
}
