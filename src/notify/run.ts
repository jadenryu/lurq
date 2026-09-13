/**
 * One pass of account email: retry what failed, send urgent alerts, and on
 * Mondays send the weekly summary to those who asked for it.
 *
 * Built so a mistake costs an unsent email rather than a flooded inbox:
 *   - an item is claimed by exactly one email before sending (unique key)
 *   - a delivery's idempotency key is unique here AND sent to Resend, so a
 *     retry of a send that actually landed is dropped on both sides
 *   - urgent email is capped per account per day; overflow waits, it is not lost
 *   - nothing is deleted; a failure is a row with an attempt count
 *   - a permanent failure (bad address, no verified email) is never retried
 */
import { createHash } from 'node:crypto';
import { getConfig } from '../core/config';
import { logger } from '../core/logger';
import type { Database } from '../db/client';
import {
  claimItems,
  claimedKeys,
  countDeliveries,
  createDelivery,
  digestSubscribers,
  getOrCreatePreferences,
  itemKeysFor,
  markDigestSent,
  retryableDeliveries,
  updateDelivery,
  type NotificationKind,
} from '../db/notifications';
import type { NotificationDeliveryRow, NotificationPreferencesRow } from '../db/schema';
import { lookupEmail as clerkLookup, sendEmail, SendError, type OutgoingEmail } from './email';
import { renderDigest, renderUrgent, type Rendered, type UrgentItem } from './render';
import { buildDigest, loadUrgentItems, sortUrgent, urgentCandidates } from './sources';

export const MAX_URGENT_PER_DAY = 3;
export const MAX_ITEMS_PER_EMAIL = 20;
export const MAX_ATTEMPTS = 3;
/** Retries stay inside Resend's 24h idempotency window, with margin. */
const RETRY_WINDOW_MS = 20 * 3_600_000;
const DAY_MS = 86_400_000;

export interface NotifyDeps {
  db: Database;
  webUrl: string;
  send: (msg: OutgoingEmail) => Promise<{ id: string }>;
  lookupEmail: (ownerId: string) => Promise<string | null>;
  now?: Date;
  maxUrgentPerDay?: number;
}

export interface NotifySummary {
  urgentSent: number;
  digestSent: number;
  retried: number;
  skipped: number;
  failed: number;
  /** Urgent items held back by the daily cap; they go out in a later pass. */
  deferred: number;
}

/** The Monday window for the weekly summary: 13:00 UTC onward, so it lands in a working morning across the US and Europe. */
export function isDigestWindow(now: Date): boolean {
  return now.getUTCDay() === 1 && now.getUTCHours() >= 13;
}

/** ISO-8601 week, e.g. `2026-W38`: the digest's once-a-week key. */
export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function links(webUrl: string, prefs: NotificationPreferencesRow, kind: NotificationKind) {
  const q = `token=${encodeURIComponent(prefs.unsubscribeToken)}&kind=${kind}`;
  return {
    // The page asks before unsubscribing, so link scanners that follow every
    // URL in a message cannot turn someone's alerts off.
    unsubscribeUrl: `${webUrl}/unsubscribe?${q}`,
    oneClickUrl: `${webUrl}/api/unsubscribe?${q}`,
    settingsUrl: `${webUrl}/dashboard/notifications`,
  };
}

type Outcome = 'sent' | 'skipped' | 'failed';

async function deliver(
  deps: NotifyDeps,
  delivery: NotificationDeliveryRow,
  prefs: NotificationPreferencesRow,
  render: (l: ReturnType<typeof links>) => Rendered,
): Promise<Outcome> {
  const { db } = deps;
  const attempts = delivery.attempts + 1;
  let to: string | null;
  try {
    to = await deps.lookupEmail(delivery.ownerId);
  } catch (err) {
    const retryable = !(err instanceof SendError) || err.retryable;
    await updateDelivery(db, delivery.id, { status: 'failed', attempts: retryable ? attempts : MAX_ATTEMPTS, error: 'could not read the account email' });
    return 'failed';
  }
  if (!to) {
    await updateDelivery(db, delivery.id, { status: 'skipped', attempts, error: 'no verified primary email' });
    return 'skipped';
  }

  const l = links(deps.webUrl, prefs, delivery.kind);
  const body = render(l);
  try {
    const { id } = await deps.send({
      to,
      ...body,
      idempotencyKey: delivery.idempotencyKey,
      headers: {
        'List-Unsubscribe': `<${l.oneClickUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });
    await updateDelivery(db, delivery.id, { status: 'sent', attempts, providerId: id || null, sentAt: new Date(), error: null });
    return 'sent';
  } catch (err) {
    const retryable = !(err instanceof SendError) || err.retryable;
    await updateDelivery(db, delivery.id, {
      status: 'failed',
      attempts: retryable ? attempts : MAX_ATTEMPTS,
      error: (err instanceof Error ? err.message : String(err)).slice(0, 300),
    });
    return 'failed';
  }
}

function tally(s: NotifySummary, outcome: Outcome, kind: NotificationKind) {
  if (outcome === 'sent') {
    if (kind === 'urgent') s.urgentSent++;
    else s.digestSent++;
  } else if (outcome === 'skipped') s.skipped++;
  else s.failed++;
}

export async function runNotifications(deps: NotifyDeps): Promise<NotifySummary> {
  const { db, webUrl } = deps;
  const now = deps.now ?? new Date();
  const cap = deps.maxUrgentPerDay ?? MAX_URGENT_PER_DAY;
  const s: NotifySummary = { urgentSent: 0, digestSent: 0, retried: 0, skipped: 0, failed: 0, deferred: 0 };

  // 1. Retries first, so a transient outage clears before new mail queues up.
  for (const d of await retryableDeliveries(db, new Date(now.getTime() - RETRY_WINDOW_MS), MAX_ATTEMPTS)) {
    const prefs = await getOrCreatePreferences(db, d.ownerId);
    if ((d.kind === 'urgent' && !prefs.urgentEmail) || (d.kind === 'digest' && !prefs.weeklyDigest)) {
      await updateDelivery(db, d.id, { status: 'skipped', error: 'turned off before a retry' });
      s.skipped++;
      continue;
    }
    // Rebuilt from the source rows, which may be gone by now (a disconnected repo
    // takes its alerts with it). An empty email is never sent: no items, no mail.
    const render = async () => {
      if (d.kind === 'urgent') {
        const items = await loadUrgentItems(db, await itemKeysFor(db, d.id), webUrl);
        return items.length ? renderUrgent(items, links(webUrl, prefs, 'urgent')) : null;
      }
      const summary = await buildDigest(db, d.ownerId, now, webUrl);
      return summary ? renderDigest(summary, links(webUrl, prefs, 'digest')) : null;
    };
    const rendered = await render();
    if (!rendered) {
      await updateDelivery(db, d.id, { status: 'skipped', error: 'nothing left to send' });
      s.skipped++;
      continue;
    }
    s.retried++;
    const outcome = await deliver(deps, d, prefs, () => rendered);
    tally(s, outcome, d.kind);
    if (outcome === 'sent' && d.kind === 'digest') await markDigestSent(db, d.ownerId, now);
  }

  // 2. Urgent.
  const candidates = await urgentCandidates(db, now, webUrl);
  const allKeys = [...candidates.values()].flat().map((i) => i.key);
  const taken = await claimedKeys(db, allKeys);

  for (const [ownerId, found] of candidates) {
    const fresh = sortUrgent(found.filter((i) => !taken.has(i.key)));
    if (!fresh.length) continue;
    const prefs = await getOrCreatePreferences(db, ownerId);
    if (!prefs.urgentEmail) continue;
    if ((await countDeliveries(db, ownerId, 'urgent', new Date(now.getTime() - DAY_MS))) >= cap) {
      s.deferred += fresh.length;
      continue;
    }

    const batch = fresh.slice(0, MAX_ITEMS_PER_EMAIL);
    const keyHash = createHash('sha256').update(batch.map((i) => i.key).sort().join('|')).digest('hex').slice(0, 24);
    const { row, created } = await createDelivery(db, { ownerId, kind: 'urgent', idempotencyKey: `urgent:${ownerId}:${keyHash}` });
    if (!created) continue;

    const won = new Set(await claimItems(db, ownerId, row.id, batch.map((i) => i.key)));
    const items: UrgentItem[] = batch.filter((i) => won.has(i.key));
    if (!items.length) {
      await updateDelivery(db, row.id, { status: 'skipped', error: 'every item was claimed by another run' });
      s.skipped++;
      continue;
    }
    tally(s, await deliver(deps, row, prefs, (l) => renderUrgent(items, l)), 'urgent');
  }

  // 3. Weekly summary, opt-in only.
  if (isDigestWindow(now)) {
    const week = isoWeek(now);
    for (const prefs of await digestSubscribers(db)) {
      if (prefs.lastDigestAt && now.getTime() - prefs.lastDigestAt.getTime() < 5 * DAY_MS) continue;
      const { row, created } = await createDelivery(db, { ownerId: prefs.ownerId, kind: 'digest', idempotencyKey: `digest:${prefs.ownerId}:${week}` });
      if (!created) continue;
      const summary = await buildDigest(db, prefs.ownerId, now, webUrl);
      if (!summary) {
        await updateDelivery(db, row.id, { status: 'skipped', error: 'nothing watched' });
        s.skipped++;
        continue;
      }
      const outcome = await deliver(deps, row, prefs, (l) => renderDigest(summary, l));
      tally(s, outcome, 'digest');
      if (outcome === 'sent') await markDigestSent(db, prefs.ownerId, now);
    }
  }

  return s;
}

/** Is email configured on this deployment? Both keys, or nothing is sent. */
export function emailConfigured(): boolean {
  const c = getConfig();
  return Boolean(c.RESEND_API_KEY && c.CLERK_SECRET_KEY);
}

/** The worker's entry point: real Resend and Clerk, or null when unconfigured. */
export async function notifyFromConfig(db: Database): Promise<NotifySummary | null> {
  const c = getConfig();
  if (!c.RESEND_API_KEY || !c.CLERK_SECRET_KEY) {
    logger.debug('notify: RESEND_API_KEY or CLERK_SECRET_KEY unset; no email sent');
    return null;
  }
  return runNotifications({
    db,
    webUrl: c.LURQ_WEB_URL.replace(/\/$/, ''),
    send: (msg) => sendEmail(msg, { apiKey: c.RESEND_API_KEY!, from: c.LURQ_MAIL_FROM }),
    lookupEmail: (ownerId) => clerkLookup(ownerId, { secretKey: c.CLERK_SECRET_KEY! }),
  });
}
