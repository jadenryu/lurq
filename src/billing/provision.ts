/**
 * One-shot Stripe provisioning: products, prices and the webhook endpoint.
 *
 * Configuring billing by hand means creating two products, matching their
 * amounts to `core/plans.ts` by eye, picking four event types out of a list of
 * two hundred, and copying three ids into environment variables. Every one of
 * those is a place to make a silent mistake, and the worst of them has no
 * symptom: a webhook subscribed to the wrong events leaves checkout working,
 * customers charged, and nobody ever upgraded.
 *
 * So this does it from the same table the app enforces, and prints exactly what
 * to set. IDEMPOTENT: it looks for what it would create before creating it, so
 * running it twice is a no-op and re-running after editing a plan's price adds
 * the new Price rather than duplicating the Product. Stripe Prices are
 * immutable, which is why a changed amount is a new Price and the old one is
 * left alone rather than deleted, existing subscribers keep the rate they
 * signed up at until you migrate them deliberately.
 *
 * Never destructive. It creates and it reports; it does not delete products,
 * archive prices, or cancel anything.
 */
import type Stripe from 'stripe';
import { logger } from '../core/logger';
import { PLAN_LIST, type Plan } from '../core/plans';
import { stripeClient } from './stripe';

/** The only events the webhook acts on. Anything else is acknowledged and dropped. */
export const WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
] as const;

/** Stamped on everything this creates, so a re-run can find its own work. */
const MARKER = 'lurq_tier';

export interface ProvisionResult {
  env: Record<string, string>;
  notes: string[];
}

/** Plans that get a self-serve Price. Enterprise is sold by conversation. */
function sellable(): Plan[] {
  return PLAN_LIST.filter((p) => p.paid && !p.contactOnly);
}

async function findProduct(stripe: Stripe, tier: string): Promise<Stripe.Product | null> {
  // `search` is eventually consistent and returns nothing for a product created
  // seconds ago, which would make two runs in a row create two products. Listing
  // is immediately consistent, and at this scale there are single digits of them.
  for await (const product of stripe.products.list({ active: true, limit: 100 })) {
    if (product.metadata?.[MARKER] === tier) return product;
  }
  return null;
}

async function findPrice(
  stripe: Stripe,
  productId: string,
  amount: number,
): Promise<Stripe.Price | null> {
  for await (const price of stripe.prices.list({ product: productId, active: true, limit: 100 })) {
    if (
      price.unit_amount === amount &&
      price.currency === 'usd' &&
      price.recurring?.interval === 'month'
    ) {
      return price;
    }
  }
  return null;
}

/**
 * Create or reuse the Product and monthly Price for one plan.
 * Returns the Price id to put in the environment.
 */
async function provisionPlan(stripe: Stripe, plan: Plan, notes: string[]): Promise<string> {
  let product = await findProduct(stripe, plan.tier);
  if (product) {
    notes.push(`product for ${plan.tier}: reused ${product.id}`);
  } else {
    product = await stripe.products.create({
      name: `lurq ${plan.name}`,
      description: plan.tagline,
      metadata: { [MARKER]: plan.tier },
    });
    notes.push(`product for ${plan.tier}: created ${product.id}`);
  }

  const existing = await findPrice(stripe, product.id, plan.priceCents);
  if (existing) {
    notes.push(`price for ${plan.tier}: reused ${existing.id} ($${plan.priceCents / 100}/mo)`);
    return existing.id;
  }

  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: plan.priceCents,
    currency: 'usd',
    recurring: { interval: 'month' },
    metadata: { [MARKER]: plan.tier },
  });
  notes.push(`price for ${plan.tier}: created ${price.id} ($${plan.priceCents / 100}/mo)`);
  return price.id;
}

/**
 * Create or correct the webhook endpoint.
 *
 * An endpoint that already exists for this URL has its event list *replaced*
 * rather than left alone: the common failure is one that exists but is
 * subscribed to the wrong events, and quietly leaving that in place is exactly
 * the outcome this command exists to prevent. The signing secret is only
 * readable at creation, so a reused endpoint reports that rather than pretending
 * it can hand one over.
 */
async function provisionWebhook(
  stripe: Stripe,
  url: string,
  notes: string[],
): Promise<string | null> {
  for await (const endpoint of stripe.webhookEndpoints.list({ limit: 100 })) {
    if (endpoint.url !== url) continue;
    const have = new Set(endpoint.enabled_events);
    const missing = WEBHOOK_EVENTS.filter((e) => !have.has(e));
    if (missing.length > 0 || endpoint.enabled_events.length !== WEBHOOK_EVENTS.length) {
      await stripe.webhookEndpoints.update(endpoint.id, {
        enabled_events: [...WEBHOOK_EVENTS] as Stripe.WebhookEndpointUpdateParams.EnabledEvent[],
      });
      notes.push(`webhook: corrected ${endpoint.id} to the 4 events lurq handles`);
    } else {
      notes.push(`webhook: reused ${endpoint.id}, already correct`);
    }
    notes.push(
      'webhook: the signing secret is only shown at creation. If you do not have it, ' +
        'roll it in the Stripe dashboard and set STRIPE_WEBHOOK_SECRET to the new value.',
    );
    return null;
  }

  const created = await stripe.webhookEndpoints.create({
    url,
    enabled_events: [...WEBHOOK_EVENTS] as Stripe.WebhookEndpointCreateParams.EnabledEvent[],
    description: 'lurq billing (created by `lurq billing setup`)',
  });
  notes.push(`webhook: created ${created.id} → ${url}`);
  return created.secret ?? null;
}

export async function provisionBilling(webhookUrl: string): Promise<ProvisionResult> {
  const stripe = await stripeClient();
  if (!stripe) {
    throw new Error('STRIPE_SECRET_KEY is not set. Export it, then re-run.');
  }

  const notes: string[] = [];
  const env: Record<string, string> = {};

  for (const plan of sellable()) {
    const priceId = await provisionPlan(stripe, plan, notes);
    env[`STRIPE_PRICE_${plan.tier.toUpperCase()}`] = priceId;
  }

  const secret = await provisionWebhook(stripe, webhookUrl, notes);
  if (secret) env.STRIPE_WEBHOOK_SECRET = secret;

  for (const n of notes) logger.info(`billing: ${n}`);
  return { env, notes };
}

/** Read back what is configured, without changing anything. */
export async function billingStatus(): Promise<string[]> {
  const stripe = await stripeClient();
  if (!stripe) return ['STRIPE_SECRET_KEY is not set: billing is off and /billing/* returns 404.'];

  const out: string[] = [];
  // Which mode the key is in, so a test key is obvious before you go looking for
  // why live checkouts are not appearing anywhere.
  const balance = await stripe.balance.retrieve();
  out.push(`key mode: ${balance.livemode ? 'LIVE' : 'test'}`);

  for (const plan of sellable()) {
    const product = await findProduct(stripe, plan.tier);
    if (!product) {
      out.push(`${plan.tier}: NO product. Run \`billing setup\`.`);
      continue;
    }
    const price = await findPrice(stripe, product.id, plan.priceCents);
    out.push(
      price
        ? `${plan.tier}: ${price.id} at $${plan.priceCents / 100}/mo — set STRIPE_PRICE_${plan.tier.toUpperCase()} to this`
        : `${plan.tier}: product ${product.id} exists but has no $${plan.priceCents / 100}/mo price. Run \`billing setup\`.`,
    );
  }

  for await (const endpoint of stripe.webhookEndpoints.list({ limit: 100 })) {
    const have = new Set(endpoint.enabled_events);
    const missing = WEBHOOK_EVENTS.filter((e) => !have.has(e));
    out.push(
      missing.length === 0
        ? `webhook ${endpoint.url}: all 4 events subscribed (${endpoint.status})`
        : `webhook ${endpoint.url}: MISSING ${missing.join(', ')} — nobody will be upgraded`,
    );
  }
  return out;
}
