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
import { PLAN_LIST, annualPriceCents, type BillingInterval, type Plan } from '../core/plans';
import { OVERAGE_EVENT } from './overage';
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

/**
 * Stripe tax code for the products, and a prerequisite for Managed Payments,
 * which refuses any product without an eligible one.
 *
 * `txcd_10103100` is the SaaS category. Set on every product whether or not
 * Managed Payments is switched on, because it is inert until then and getting
 * it in place early is what makes enabling the flag a one-variable change.
 *
 * Worth confirming against the tax-code picker in the Stripe dashboard rather
 * than taking this constant's word for it: the code decides what tax gets
 * charged and remitted, and the wrong one is wrong in a direction that matters.
 */
const TAX_CODE = 'txcd_10103100';

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
  interval: BillingInterval = 'month',
): Promise<Stripe.Price | null> {
  for await (const price of stripe.prices.list({ product: productId, active: true, limit: 100 })) {
    if (
      price.unit_amount === amount &&
      price.currency === 'usd' &&
      price.recurring?.interval === interval &&
      price.recurring?.usage_type !== 'metered'
    ) {
      return price;
    }
  }
  return null;
}

/**
 * Create or reuse the Product, its monthly and yearly Prices, and its metered
 * overage Price when the plan has one. Returns the env vars to set.
 */
async function provisionPlan(
  stripe: Stripe,
  plan: Plan,
  notes: string[],
): Promise<Record<string, string>> {
  let product = await findProduct(stripe, plan.tier);
  if (product) {
    // A product created before Managed Payments existed has no tax code, and
    // without one the Checkout Session is rejected. Patch rather than skip, so
    // a re-run repairs the account instead of reporting it as already fine.
    if (product.tax_code == null) {
      product = await stripe.products.update(product.id, { tax_code: TAX_CODE });
      notes.push(`product for ${plan.tier}: reused ${product.id}, set tax_code ${TAX_CODE}`);
    } else {
      notes.push(`product for ${plan.tier}: reused ${product.id}`);
    }
  } else {
    product = await stripe.products.create({
      name: `lurq ${plan.name}`,
      description: plan.tagline,
      tax_code: TAX_CODE,
      metadata: { [MARKER]: plan.tier },
    });
    notes.push(`product for ${plan.tier}: created ${product.id}`);
  }

  const env: Record<string, string> = {};
  const key = `STRIPE_PRICE_${plan.tier.toUpperCase()}`;
  for (const interval of ['month', 'year'] as const) {
    const amount = interval === 'year' ? annualPriceCents(plan) : plan.priceCents;
    const existing = await findPrice(stripe, product.id, amount, interval);
    const price =
      existing ??
      (await stripe.prices.create({
        product: product.id,
        unit_amount: amount,
        currency: 'usd',
        recurring: { interval },
        metadata: { [MARKER]: plan.tier },
      }));
    notes.push(
      `price for ${plan.tier}: ${existing ? 'reused' : 'created'} ${price.id} ($${amount / 100}/${interval})`,
    );
    env[interval === 'year' ? `${key}_ANNUAL` : key] = price.id;
  }
  if (plan.overageCentsPer1k) {
    env[`${key}_OVERAGE`] = await provisionOverage(
      stripe,
      product.id,
      plan.tier,
      plan.overageCentsPer1k,
      notes,
    );
  }
  return env;
}

/**
 * The meter that counts overage calls, and the metered Price billed from it.
 * `transform_quantity` turns summed calls into started thousands, so the Price
 * reads "$8 per 1,000" in Stripe exactly as it does on the pricing page.
 */
async function provisionOverage(
  stripe: Stripe,
  productId: string,
  tier: string,
  centsPer1k: number,
  notes: string[],
): Promise<string> {
  let meter: Stripe.Billing.Meter | null = null;
  for await (const m of stripe.billing.meters.list({ status: 'active', limit: 100 })) {
    if (m.event_name === OVERAGE_EVENT) {
      meter = m;
      break;
    }
  }
  if (meter) {
    notes.push(`meter ${OVERAGE_EVENT}: reused ${meter.id}`);
  } else {
    meter = await stripe.billing.meters.create({
      display_name: 'lurq overage calls',
      event_name: OVERAGE_EVENT,
      default_aggregation: { formula: 'sum' },
      customer_mapping: { type: 'by_id', event_payload_key: 'stripe_customer_id' },
      value_settings: { event_payload_key: 'value' },
    });
    notes.push(`meter ${OVERAGE_EVENT}: created ${meter.id}`);
  }

  for await (const price of stripe.prices.list({ product: productId, active: true, limit: 100 })) {
    if (price.recurring?.meter === meter.id && price.unit_amount === centsPer1k) {
      notes.push(`overage price for ${tier}: reused ${price.id}`);
      return price.id;
    }
  }
  const price = await stripe.prices.create({
    product: productId,
    currency: 'usd',
    unit_amount: centsPer1k,
    recurring: { interval: 'month', usage_type: 'metered', meter: meter.id },
    transform_quantity: { divide_by: 1000, round: 'up' },
    metadata: { [MARKER]: `${tier}_overage` },
  });
  notes.push(`overage price for ${tier}: created ${price.id} ($${centsPer1k / 100} per 1,000 calls)`);
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
    Object.assign(env, await provisionPlan(stripe, plan, notes));
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
