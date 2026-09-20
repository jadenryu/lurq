/**
 * The Stripe webhook's request handling, apart from Express so the status it
 * answers with is testable without a server or a database.
 *
 * Process first, then answer. The route used to 200 before doing the work, and
 * when the work threw Stripe had already recorded a successful delivery and
 * never retried: a paying customer stayed on Free with nothing but a log line to
 * show for it (see the comment on `setWhere` in db/subscriptions.ts — that
 * happened to every event for a while). A 5xx now makes Stripe retry with
 * backoff for up to three days, which turns a database blip or a failed
 * `subscriptions.retrieve` into a delay instead of a lost upgrade.
 *
 * Retrying is safe because applying an event is idempotent: the upsert's
 * `last_event_at <= event time` guard lets a redelivery of the same event write
 * the same values again, and drops anything older than what the row already
 * reflects, so a retry that lands after a newer event cannot roll it back.
 * Events that verify but cannot be attributed still answer 200 (handleEvent
 * returns a reason rather than throwing): retrying those buys nothing.
 */
import { alert, errorKind } from '../core/alert';
import { formatError } from '../core/errors';
import { logger } from '../core/logger';
import type { Database } from '../db/client';
import { getSubscriptionByCustomer } from '../db/subscriptions';
import { constructEvent, handleEvent } from './stripe';

export interface WebhookReply {
  status: number;
  /** JSON body; absent means an empty response. */
  body?: unknown;
}

export async function processStripeWebhook(
  db: Database,
  raw: Buffer | undefined,
  signature: string | undefined,
  /** Drops the account's cached entitlement so a new plan applies immediately. */
  onPlanChanged: (ownerId: string) => void,
): Promise<WebhookReply> {
  let event;
  try {
    // Verified over the raw bytes: a re-serialized parse is not byte-identical.
    event = await constructEvent(raw ?? '', signature);
  } catch (err) {
    logger.warn(
      `billing webhook: bad signature: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { status: 400, body: { error: 'Invalid signature.' } };
  }
  // Billing, the webhook secret, or the signature header is missing.
  if (!event) return { status: 404 };

  try {
    const outcome = await handleEvent(db, event);
    logger.info(`billing webhook: ${outcome}`);
    // Inside the same try on purpose: if this read fails after the write landed,
    // the 5xx makes Stripe redeliver, the write re-applies harmlessly, and the
    // stale cache gets its second chance to be dropped.
    const object = event.data.object as { customer?: unknown };
    if (typeof object.customer === 'string') {
      const row = await getSubscriptionByCustomer(db, object.customer);
      if (row) onPlanChanged(row.ownerId);
    }
    return { status: 200, body: { received: true } };
  } catch (err) {
    logger.error(`billing webhook failed for ${event.type} ${event.id}:`, formatError(err));
    alert(
      'stripe-webhook',
      `${event.type} ${event.id} failed (${errorKind(err)}); Stripe will retry`,
    );
    return { status: 500, body: { error: 'Could not process the event.' } };
  }
}
