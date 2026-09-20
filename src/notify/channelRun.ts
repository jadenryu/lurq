/**
 * One pass of channel alerts: Slack, Discord, Teams and signed webhooks.
 *
 * Unlike email, a channel is a team's shared feed, so it carries everything at
 * or above the severity its owner chose rather than only the urgent three. The
 * safety rules are the email sender's, applied per channel:
 *   - an item is claimed once per channel (`ch<id>:<item>`), so it reaches each
 *     channel exactly once however many workers run
 *   - one message per channel per run, capped to what the platform accepts; the
 *     rest wait for the next run
 *   - a transient failure retries; a destination that is gone (404/410) or a URL
 *     that now resolves to a private address switches the channel off, with the
 *     reason shown to its owner; a channel that keeps failing is switched off too
 *   - the plan is checked at send time, so a downgraded account stops posting
 */
import { createHash } from 'node:crypto';
import { SEVERITY_RANK, type Severity } from '../audit/types';
import { billingEnabled } from '../billing/stripe';
import { getConfig } from '../core/config';
import { logger } from '../core/logger';
import { open, secretKey } from '../core/secretBox';
import type { Database } from '../db/client';
import {
  activeChannels,
  channelById,
  claimItems,
  claimedKeys,
  createDelivery,
  itemKeysFor,
  retryableDeliveries,
  updateChannel,
  updateDelivery,
} from '../db/notifications';
import type { NotificationChannelRow, NotificationDeliveryRow } from '../db/schema';
import { entitlementFor } from '../db/subscriptions';
import { formatChannel, ITEM_CAP, type ChannelItem, type Formatted } from './channels';
import { channelCandidates, loadChannelItems } from './channelSources';
import { postJson, type PostOutcome } from './safeHttp';

export const MAX_CHANNEL_ATTEMPTS = 3;
/** Consecutive failures after which a channel is switched off. */
export const DISABLE_AFTER_FAILURES = 10;
/** Of those, how many rejections (4xx) are tolerated: they will not start working on their own. */
export const DISABLE_AFTER_REJECTIONS = 5;
const RETRY_WINDOW_MS = 20 * 3_600_000;

export interface ChannelDeps {
  db: Database;
  webUrl: string;
  secretsKey: Buffer;
  post: (url: string, message: Formatted) => Promise<PostOutcome>;
  /** Whether the owner's plan includes channels. Null when it could not be read: skip this run. */
  allowed: (ownerId: string) => Promise<boolean | null>;
  now?: Date;
}

export interface ChannelSummary {
  sent: number;
  failed: number;
  disabled: number;
  skipped: number;
}

const prefix = (channelId: number) => `ch${channelId}:`;

type Verdict =
  | { kind: 'sent' }
  | { kind: 'retry'; error: string }
  | { kind: 'reject'; error: string }
  | { kind: 'disable'; error: string };

export function classify(o: PostOutcome): Verdict {
  if (o.status >= 200 && o.status < 300) return { kind: 'sent' };
  if (o.code === 'EPRIVATE')
    return { kind: 'disable', error: 'the URL now resolves to a private network address' };
  if (o.status === 404 || o.status === 410)
    return {
      kind: 'disable',
      error: `the destination no longer exists (HTTP ${o.status}); it may have been deleted`,
    };
  if (o.status === 429 || o.status >= 500 || o.status === 0)
    return { kind: 'retry', error: o.error ?? 'no response' };
  return { kind: 'reject', error: o.error ?? `HTTP ${o.status}` };
}

async function send(
  deps: ChannelDeps,
  channel: NotificationChannelRow,
  delivery: NotificationDeliveryRow,
  items: ChannelItem[],
  more: number,
  s: ChannelSummary,
): Promise<void> {
  const { db } = deps;
  let url: string;
  let signingSecret: string | null = null;
  try {
    url = open(channel.urlCiphertext, deps.secretsKey, channel.ownerId);
    if (channel.signingSecretCiphertext)
      signingSecret = open(channel.signingSecretCiphertext, deps.secretsKey, channel.ownerId);
  } catch {
    // Wrong key, or a row that was tampered with. Retrying cannot fix either.
    await updateDelivery(db, delivery.id, {
      status: 'failed',
      attempts: MAX_CHANNEL_ATTEMPTS,
      error: 'stored URL could not be decrypted',
    });
    await updateChannel(db, channel.ownerId, channel.id, {
      enabled: false,
      disabledReason: 'the stored URL could not be read; add the channel again',
    });
    s.disabled++;
    return;
  }

  const message = formatChannel(channel.kind, items, more, {
    deliveryId: delivery.idempotencyKey,
    dashboardUrl: `${deps.webUrl}/dashboard/notifications`,
    now: deps.now ?? new Date(),
    signingSecret,
  });
  const verdict = classify(await deps.post(url, message));
  const attempts = delivery.attempts + 1;

  if (verdict.kind === 'sent') {
    await updateDelivery(db, delivery.id, {
      status: 'sent',
      attempts,
      sentAt: new Date(),
      error: null,
    });
    await updateChannel(db, channel.ownerId, channel.id, {
      consecutiveFailures: 0,
      lastError: null,
      lastDeliveredAt: new Date(),
    });
    s.sent++;
    return;
  }

  const failures = channel.consecutiveFailures + 1;
  const disable =
    verdict.kind === 'disable' ||
    failures >= DISABLE_AFTER_FAILURES ||
    (verdict.kind === 'reject' && failures >= DISABLE_AFTER_REJECTIONS);
  await updateDelivery(db, delivery.id, {
    status: 'failed',
    attempts: verdict.kind === 'retry' && !disable ? attempts : MAX_CHANNEL_ATTEMPTS,
    error: verdict.error.slice(0, 300),
  });
  await updateChannel(db, channel.ownerId, channel.id, {
    consecutiveFailures: failures,
    lastError: verdict.error.slice(0, 300),
    ...(disable
      ? {
          enabled: false,
          disabledReason:
            verdict.kind === 'disable'
              ? verdict.error
              : `switched off after ${failures} failed deliveries in a row: ${verdict.error}`,
        }
      : {}),
  });
  if (disable) s.disabled++;
  else s.failed++;
}

export async function runChannels(deps: ChannelDeps): Promise<ChannelSummary> {
  const { db, webUrl } = deps;
  const now = deps.now ?? new Date();
  const s: ChannelSummary = { sent: 0, failed: 0, disabled: 0, skipped: 0 };
  const planCache = new Map<string, boolean | null>();
  const allowed = async (ownerId: string) => {
    if (!planCache.has(ownerId))
      planCache.set(ownerId, await deps.allowed(ownerId).catch(() => null));
    return planCache.get(ownerId);
  };

  // 1. Retries.
  for (const d of await retryableDeliveries(
    db,
    new Date(now.getTime() - RETRY_WINDOW_MS),
    MAX_CHANNEL_ATTEMPTS,
    ['channel'],
  )) {
    const channel = d.channelId ? await channelById(db, d.channelId) : null;
    if (!channel || !channel.enabled || (await allowed(channel.ownerId)) !== true) {
      await updateDelivery(db, d.id, {
        status: 'skipped',
        error: 'channel removed, switched off, or no longer on a plan with channels',
      });
      s.skipped++;
      continue;
    }
    const keys = (await itemKeysFor(db, d.id)).map((k) => k.slice(prefix(channel.id).length));
    const items = await loadChannelItems(db, keys, webUrl);
    if (!items.length) {
      await updateDelivery(db, d.id, { status: 'skipped', error: 'nothing left to send' });
      s.skipped++;
      continue;
    }
    await send(deps, channel, d, items, 0, s);
  }

  // 2. New items, per channel.
  const candidates = await channelCandidates(db, now, webUrl);
  if (!candidates.size) return s;
  const channels = (await activeChannels(db)).filter((c) => candidates.has(c.ownerId));

  for (const channel of channels) {
    if ((await allowed(channel.ownerId)) !== true) continue;
    const eligible = candidates
      .get(channel.ownerId)!
      .filter((i) => SEVERITY_RANK[i.severity] <= SEVERITY_RANK[channel.minSeverity])
      .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
    if (!eligible.length) continue;

    const taken = await claimedKeys(
      db,
      eligible.map((i) => prefix(channel.id) + i.key),
    );
    const fresh = eligible.filter((i) => !taken.has(prefix(channel.id) + i.key));
    if (!fresh.length) continue;

    const batch = fresh.slice(0, ITEM_CAP[channel.kind]);
    const hash = createHash('sha256')
      .update(
        batch
          .map((i) => i.key)
          .sort()
          .join('|'),
      )
      .digest('hex')
      .slice(0, 24);
    const { row, created } = await createDelivery(db, {
      ownerId: channel.ownerId,
      kind: 'channel',
      channelId: channel.id,
      idempotencyKey: `channel:${channel.id}:${hash}`,
    });
    if (!created) continue;
    const won = new Set(
      await claimItems(
        db,
        channel.ownerId,
        row.id,
        batch.map((i) => prefix(channel.id) + i.key),
      ),
    );
    const items = batch.filter((i) => won.has(prefix(channel.id) + i.key));
    if (!items.length) {
      await updateDelivery(db, row.id, {
        status: 'skipped',
        error: 'every item was claimed by another run',
      });
      s.skipped++;
      continue;
    }
    await send(deps, channel, row, items, fresh.length - items.length, s);
  }
  return s;
}

/** Whether an owner may use channels: the plan decides, unless billing is off (self-hosted), where nothing is gated. */
export async function channelsAllowed(db: Database, ownerId: string): Promise<boolean> {
  if (!billingEnabled()) return true;
  return (await entitlementFor(db, ownerId)).plan.alertChannels;
}

/** The worker's entry point, or null when no secrets key is configured. */
export async function channelsFromConfig(db: Database): Promise<ChannelSummary | null> {
  const c = getConfig();
  const key = secretKey(c.LURQ_SECRETS_KEY);
  if (!key) {
    logger.debug('notify: LURQ_SECRETS_KEY unset; alert channels disabled');
    return null;
  }
  return runChannels({
    db,
    webUrl: c.LURQ_WEB_URL.replace(/\/$/, ''),
    secretsKey: key,
    post: (url, m) => postJson(url, m.payload, m.headers),
    allowed: (ownerId) => channelsAllowed(db, ownerId),
  });
}

export type { Severity };
