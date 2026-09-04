/**
 * Stripe, and the only place in the codebase that holds a Stripe credential.
 *
 * The web app has none. It reaches checkout and the portal through the
 * issuer-secret routes on this service, exactly the way it reaches key issuance,
 * so the surface that faces the internet keeps holding nothing worth stealing.
 *
 * The SDK is imported dynamically. `stripe` is a dependency of the published
 * `lurqrun` package only because this file lives in the same tree, and a static
 * import would make every CLI invocation — `lurq recommend` on someone's laptop
 * — pay to load a payments SDK it will never call. Same reason express and
 * helmet are dynamic in mcp/http.ts.
 */
import type Stripe from 'stripe';
import { getConfig } from '../core/config';
import { logger } from '../core/logger';
import { PLANS, type Tier } from '../core/plans';
import type { Database } from '../db/client';
import { applySubscriptionEvent, getSubscription, linkCustomer } from '../db/subscriptions';

/**
 * Pinned deliberately. Stripe's API is versioned per-account, and letting the
 * SDK send whatever it defaults to means an SDK bump can silently change the
 * shape of the objects the webhook reads. Move this on purpose, after reading
 * the changelog, not as a side effect of `npm update`.
 */
const API_VERSION = '2025-03-31.basil';

let clientPromise: Promise<Stripe | null> | null = null;

/** Null when STRIPE_SECRET_KEY is unset, which disables billing everywhere. */
export async function stripeClient(): Promise<Stripe | null> {
  const { STRIPE_SECRET_KEY } = getConfig();
  if (!STRIPE_SECRET_KEY) return null;
  if (!clientPromise) {
    clientPromise = (async () => {
      const { default: StripeCtor } = await import('stripe');
      return new StripeCtor(STRIPE_SECRET_KEY, {
        apiVersion: API_VERSION as Stripe.LatestApiVersion,
        // Retries on Stripe's side of a network blip. The default is 0, which
        // turns one dropped connection into a failed checkout for a real person.
        maxNetworkRetries: 2,
        timeout: 15_000,
      });
    })();
  }
  return clientPromise;
}

export function billingEnabled(): boolean {
  return Boolean(getConfig().STRIPE_SECRET_KEY);
}

/** The configured Price id for a tier, or null if that tier is not self-serve. */
export function priceIdFor(tier: Tier): string | null {
  const config = getConfig();
  if (tier === 'pro') return config.STRIPE_PRICE_PRO ?? null;
  if (tier === 'enterprise') return config.STRIPE_PRICE_ENTERPRISE ?? null;
  return null;
}

/**
 * Reverse of {@link priceIdFor}: which tier a Stripe Price grants.
 *
 * Falls back to the tier stamped in subscription metadata at checkout, because
 * a Price can be swapped in the dashboard (a promo, a grandfathered rate) and an
 * unrecognised Price must not silently downgrade a paying customer to free.
 * Unknown and unstamped means free, which is the safe direction to be wrong in
 * for entitlement but the one to watch the logs for.
 */
export function tierForPrice(priceId: string | null, metadataTier?: string | null): Tier {
  const config = getConfig();
  if (priceId && priceId === config.STRIPE_PRICE_PRO) return 'pro';
  if (priceId && priceId === config.STRIPE_PRICE_ENTERPRISE) return 'enterprise';
  if (metadataTier && metadataTier in PLANS) return metadataTier as Tier;
  if (priceId) {
    logger.warn(`billing: price ${priceId} maps to no configured tier; treating as free`);
  }
  return 'free';
}

/**
 * The account's Stripe customer, created on first need.
 *
 * `ownerId` goes into customer metadata as well as our own table: a webhook for
 * a customer whose row we somehow lack can still be attributed, and a human
 * looking at the Stripe dashboard can tell who a customer is without a join.
 */
export async function customerFor(
  db: Database,
  ownerId: string,
  email?: string | null,
): Promise<string | null> {
  const stripe = await stripeClient();
  if (!stripe) return null;

  const existing = await getSubscription(db, ownerId);
  if (existing?.stripeCustomerId) return existing.stripeCustomerId;

  const customer = await stripe.customers.create({
    ...(email ? { email } : {}),
    metadata: { ownerId },
  });
  await linkCustomer(db, ownerId, customer.id);
  return customer.id;
}

export interface CheckoutRequest {
  ownerId: string;
  tier: Tier;
  email?: string | null;
}

/**
 * A hosted Checkout Session for a paid plan. Returns the URL to send the
 * browser to, or null when billing or that tier is not configured.
 *
 * Nothing is granted here. Since API version 2025-03-31.basil the subscription
 * is not even created until payment completes, so the success redirect proves
 * only that the customer reached the end of a form. Entitlement is written by
 * the webhook and nowhere else.
 */
export async function createCheckoutSession(
  db: Database,
  req: CheckoutRequest,
): Promise<string | null> {
  const stripe = await stripeClient();
  if (!stripe) return null;

  const price = priceIdFor(req.tier);
  if (!price) return null;

  const customer = await customerFor(db, req.ownerId, req.email);
  if (!customer) return null;

  const config = getConfig();
  const base = config.LURQ_WEB_URL.replace(/\/$/, '');
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: 'subscription',
    customer,
    line_items: [{ price, quantity: 1 }],
    // Stripe substitutes the real id. The dashboard reads it to poll for the
    // webhook having landed, so the page after payment can say "active" rather
    // than "we think so".
    success_url: `${base}/dashboard/billing?checkout={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/#pricing`,
    // Carried onto the Subscription so tierForPrice has a fallback if the Price
    // is later swapped out from under us.
    subscription_data: { metadata: { ownerId: req.ownerId, tier: req.tier } },
    metadata: { ownerId: req.ownerId, tier: req.tier },
    allow_promotion_codes: true,
    // Stripe Tax works out VAT/sales tax per the customer's address. On its own
    // that is only half of merchant-of-record: registration and remittance stay
    // ours. STRIPE_MANAGED_PAYMENTS below buys the other half when it is on.
    // Left enabled either way — it is what calculates tax when it is off, and
    // Managed Payments supersedes rather than conflicts with it when it is on.
    automatic_tax: { enabled: true },
    billing_address_collection: 'auto',
  };

  // Sent on every session, true or false, because Stripe applies an account-level
  // default when the parameter is absent — so omitting it would let a dashboard
  // toggle decide, and the symptom of that disagreeing with our products is a 400
  // in someone's checkout. Not in stripe@22.6.0's types yet, so it goes on via a
  // narrow cast rather than widening the whole params object (every other
  // parameter stays checked) and rather than bumping the SDK, which would move
  // the pinned API version's object shapes out from under handleEvent.
  (params as Record<string, unknown>).managed_payments = {
    enabled: config.STRIPE_MANAGED_PAYMENTS,
  };

  const session = await stripe.checkout.sessions.create(params);
  return session.url;
}

/** Stripe's own subscription-management UI. Null if the account has no customer. */
export async function createPortalSession(db: Database, ownerId: string): Promise<string | null> {
  const stripe = await stripeClient();
  if (!stripe) return null;

  const sub = await getSubscription(db, ownerId);
  if (!sub?.stripeCustomerId) return null;

  const base = getConfig().LURQ_WEB_URL.replace(/\/$/, '');
  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: `${base}/dashboard/billing`,
  });
  return session.url;
}

/** Verify a webhook payload. Throws when the signature does not check out. */
export async function constructEvent(
  raw: Buffer | string,
  signature: string | undefined,
): Promise<Stripe.Event | null> {
  const stripe = await stripeClient();
  const secret = getConfig().STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret || !signature) return null;
  return stripe.webhooks.constructEvent(raw, signature, secret);
}

/** Events that move entitlement. Everything else is acknowledged and ignored. */
const HANDLED = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);

function periodEnd(sub: Stripe.Subscription): Date | null {
  // Basil moved current_period_end onto the subscription item. Read the item
  // first and fall back, so this survives both shapes rather than silently
  // recording null and showing "renews —" in the dashboard forever.
  const item = sub.items?.data?.[0] as { current_period_end?: number } | undefined;
  const raw =
    item?.current_period_end ??
    (sub as unknown as { current_period_end?: number }).current_period_end;
  return typeof raw === 'number' ? new Date(raw * 1000) : null;
}

/**
 * Apply one verified event. Returns what happened, for the log.
 *
 * Deliberately tolerant: an event we cannot attribute is a warning and a 200,
 * never a 500. Stripe retries a non-2xx for three days, so answering an
 * unattributable event with an error buys a retry storm and no new information.
 */
export async function handleEvent(db: Database, event: Stripe.Event): Promise<string> {
  if (!HANDLED.has(event.type)) return `ignored ${event.type}`;

  const stripe = await stripeClient();
  if (!stripe) return 'billing disabled';

  let subscription: Stripe.Subscription | null = null;

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const id =
      typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
    // A one-off or setup-mode session has no subscription. Nothing to grant.
    if (!id) return 'checkout completed with no subscription';
    subscription = await stripe.subscriptions.retrieve(id);
  } else {
    subscription = event.data.object as Stripe.Subscription;
  }

  const customerId =
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
  if (!customerId) return 'event carried no customer';

  const priceId = subscription.items?.data?.[0]?.price?.id ?? null;
  // A deleted subscription grants nothing regardless of which Price it held.
  const tier: Tier =
    event.type === 'customer.subscription.deleted'
      ? 'free'
      : tierForPrice(priceId, subscription.metadata?.tier);

  const applied = await applySubscriptionEvent(db, customerId, {
    tier,
    status: event.type === 'customer.subscription.deleted' ? 'canceled' : subscription.status,
    stripeSubscriptionId: subscription.id,
    currentPeriodEnd: periodEnd(subscription),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    eventAt: new Date(event.created * 1000),
  });

  return applied
    ? `${event.type}: customer ${customerId} → ${tier} (${subscription.status})`
    : `${event.type}: superseded by a newer event, dropped`;
}
