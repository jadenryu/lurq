/**
 * Storage for account email: preferences, deliveries, and the items each
 * delivery carried.
 *
 * Nothing here deletes. A failed send stays a row with its attempt count, and an
 * item stays claimed by the email it was put in, which is what keeps the rule
 * "an alert is emailed at most once" true across retries and concurrent workers.
 */
import { randomBytes } from 'node:crypto';
import { and, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { Database } from './client';
import {
  notificationChannels,
  notificationDeliveries,
  notificationItems,
  notificationPreferences,
  type NotificationChannelRow,
  type NotificationDeliveryRow,
  type NotificationPreferencesRow,
} from './schema';

export type NotificationKind = 'urgent' | 'digest' | 'channel';

const newToken = () => randomBytes(32).toString('base64url');

/** The account's preferences, created with the defaults on first read. */
export async function getOrCreatePreferences(
  db: Database,
  ownerId: string,
): Promise<NotificationPreferencesRow> {
  await db
    .insert(notificationPreferences)
    .values({ ownerId, unsubscribeToken: newToken() })
    .onConflictDoNothing();
  const [row] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.ownerId, ownerId))
    .limit(1);
  if (!row) throw new Error('notification preferences vanished after insert');
  return row;
}

export async function setPreferences(
  db: Database,
  ownerId: string,
  patch: { urgentEmail?: boolean; weeklyDigest?: boolean },
): Promise<NotificationPreferencesRow> {
  await getOrCreatePreferences(db, ownerId);
  const [row] = await db
    .update(notificationPreferences)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(notificationPreferences.ownerId, ownerId))
    .returning();
  return row!;
}

/** Turn one kind off by token. False when no account holds the token. */
export async function unsubscribeByToken(
  db: Database,
  token: string,
  kind: 'urgent' | 'digest',
): Promise<boolean> {
  const rows = await db
    .update(notificationPreferences)
    .set({
      ...(kind === 'urgent' ? { urgentEmail: false } : { weeklyDigest: false }),
      updatedAt: new Date(),
    })
    .where(eq(notificationPreferences.unsubscribeToken, token))
    .returning({ ownerId: notificationPreferences.ownerId });
  return rows.length > 0;
}

export async function digestSubscribers(db: Database): Promise<NotificationPreferencesRow[]> {
  return db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.weeklyDigest, true));
}

export async function markDigestSent(db: Database, ownerId: string, at: Date): Promise<void> {
  await db
    .update(notificationPreferences)
    .set({ lastDigestAt: at })
    .where(eq(notificationPreferences.ownerId, ownerId));
}

/**
 * Create a delivery, or find the one that already holds this key.
 * `created` is false when another run got there first: that run owns the send.
 */
export async function createDelivery(
  db: Database,
  input: {
    ownerId: string;
    kind: NotificationKind;
    idempotencyKey: string;
    channelId?: number | null;
  },
): Promise<{ row: NotificationDeliveryRow; created: boolean }> {
  const inserted = await db
    .insert(notificationDeliveries)
    .values({ ...input, status: 'pending' })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return { row: inserted[0], created: true };
  const [existing] = await db
    .select()
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.idempotencyKey, input.idempotencyKey))
    .limit(1);
  return { row: existing!, created: false };
}

/** Claim items for a delivery. Returns only the keys this call won. */
export async function claimItems(
  db: Database,
  ownerId: string,
  deliveryId: number,
  keys: string[],
): Promise<string[]> {
  if (!keys.length) return [];
  const rows = await db
    .insert(notificationItems)
    .values(keys.map((itemKey) => ({ itemKey, ownerId, deliveryId })))
    .onConflictDoNothing()
    .returning({ itemKey: notificationItems.itemKey });
  return rows.map((r) => r.itemKey);
}

/** Of these keys, which are already claimed by some email. */
export async function claimedKeys(db: Database, keys: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    const rows = await db
      .select({ itemKey: notificationItems.itemKey })
      .from(notificationItems)
      .where(inArray(notificationItems.itemKey, chunk));
    for (const r of rows) out.add(r.itemKey);
  }
  return out;
}

export async function itemKeysFor(db: Database, deliveryId: number): Promise<string[]> {
  const rows = await db
    .select({ itemKey: notificationItems.itemKey })
    .from(notificationItems)
    .where(eq(notificationItems.deliveryId, deliveryId));
  return rows.map((r) => r.itemKey);
}

export async function updateDelivery(
  db: Database,
  id: number,
  patch: Partial<
    Pick<NotificationDeliveryRow, 'status' | 'attempts' | 'error' | 'providerId' | 'sentAt'>
  >,
): Promise<void> {
  await db.update(notificationDeliveries).set(patch).where(eq(notificationDeliveries.id, id));
}

/** Emails of a kind sent (or in flight) to an owner since a moment. */
export async function countDeliveries(
  db: Database,
  ownerId: string,
  kind: NotificationKind,
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notificationDeliveries)
    .where(
      and(
        eq(notificationDeliveries.ownerId, ownerId),
        eq(notificationDeliveries.kind, kind),
        gte(notificationDeliveries.createdAt, since),
        inArray(notificationDeliveries.status, ['sent', 'pending']),
      ),
    );
  return row?.n ?? 0;
}

/** Failed deliveries still worth retrying: under the attempt ceiling and young
 *  enough that Resend's 24h idempotency window still covers a duplicate. */
export async function retryableDeliveries(
  db: Database,
  since: Date,
  maxAttempts: number,
  kinds: NotificationKind[] = ['urgent', 'digest'],
): Promise<NotificationDeliveryRow[]> {
  return db
    .select()
    .from(notificationDeliveries)
    .where(
      and(
        eq(notificationDeliveries.status, 'failed'),
        inArray(notificationDeliveries.kind, kinds),
        lt(notificationDeliveries.attempts, maxAttempts),
        gte(notificationDeliveries.createdAt, since),
      ),
    )
    .limit(200);
}

// ── Alert channels (Slack, Discord, Teams, signed webhook) ───────────────────

type NewChannel = typeof notificationChannels.$inferInsert;
type ChannelPatch = Partial<
  Pick<
    NotificationChannelRow,
    | 'label'
    | 'minSeverity'
    | 'enabled'
    | 'consecutiveFailures'
    | 'disabledReason'
    | 'lastDeliveredAt'
    | 'lastError'
  >
>;

const liveChannel = (ownerId: string, id: number) =>
  and(
    eq(notificationChannels.ownerId, ownerId),
    eq(notificationChannels.id, id),
    isNull(notificationChannels.deletedAt),
  );

export async function listChannels(
  db: Database,
  ownerId: string,
): Promise<NotificationChannelRow[]> {
  return db
    .select()
    .from(notificationChannels)
    .where(and(eq(notificationChannels.ownerId, ownerId), isNull(notificationChannels.deletedAt)))
    .orderBy(notificationChannels.id);
}

export async function getChannel(
  db: Database,
  ownerId: string,
  id: number,
): Promise<NotificationChannelRow | null> {
  const [row] = await db
    .select()
    .from(notificationChannels)
    .where(liveChannel(ownerId, id))
    .limit(1);
  return row ?? null;
}

export async function insertChannel(
  db: Database,
  row: NewChannel,
): Promise<NotificationChannelRow> {
  const [created] = await db.insert(notificationChannels).values(row).returning();
  return created!;
}

export async function updateChannel(
  db: Database,
  ownerId: string,
  id: number,
  patch: ChannelPatch,
): Promise<NotificationChannelRow | null> {
  const [row] = await db
    .update(notificationChannels)
    .set({ ...patch, updatedAt: new Date() })
    .where(liveChannel(ownerId, id))
    .returning();
  return row ?? null;
}

/** Soft delete: the row stays, both secrets are wiped, nothing is ever sent again. */
export async function removeChannel(db: Database, ownerId: string, id: number): Promise<boolean> {
  const rows = await db
    .update(notificationChannels)
    .set({
      deletedAt: new Date(),
      enabled: false,
      urlCiphertext: '',
      signingSecretCiphertext: null,
      updatedAt: new Date(),
    })
    .where(liveChannel(ownerId, id))
    .returning({ id: notificationChannels.id });
  return rows.length > 0;
}

/** Every channel that may receive alerts, across accounts, for the sender. */
export async function activeChannels(db: Database): Promise<NotificationChannelRow[]> {
  return db
    .select()
    .from(notificationChannels)
    .where(and(eq(notificationChannels.enabled, true), isNull(notificationChannels.deletedAt)))
    .limit(10_000);
}

export async function channelById(
  db: Database,
  id: number,
): Promise<NotificationChannelRow | null> {
  const [row] = await db
    .select()
    .from(notificationChannels)
    .where(and(eq(notificationChannels.id, id), isNull(notificationChannels.deletedAt)))
    .limit(1);
  return row ?? null;
}
