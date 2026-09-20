/**
 * A second Checkout for an account that already pays would create a second
 * subscription on the same Stripe customer. It gets the billing portal instead.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  getSubscription: vi.fn(),
  checkoutCreate: vi.fn(async () => ({ url: 'https://checkout.stripe.test/s' })),
  portalCreate: vi.fn(async () => ({ url: 'https://billing.stripe.test/p' })),
  customerCreate: vi.fn(async () => ({ id: 'cus_new' })),
}));

vi.mock('../src/core/config', () => ({
  getConfig: () => ({
    STRIPE_SECRET_KEY: 'sk_test_not_a_real_key',
    STRIPE_PRICE_PRO: 'price_pro',
    LURQ_WEB_URL: 'https://lurq.run',
    STRIPE_MANAGED_PAYMENTS: false,
  }),
}));
vi.mock('stripe', () => ({
  default: class {
    customers = { create: m.customerCreate };
    checkout = { sessions: { create: m.checkoutCreate } };
    billingPortal = { sessions: { create: m.portalCreate } };
  },
}));
vi.mock('../src/db/subscriptions', () => ({
  getSubscription: m.getSubscription,
  linkCustomer: vi.fn(async () => {}),
  applySubscriptionEvent: vi.fn(),
  isManualGrant: (s: { stripeCustomerId: string }) => s.stripeCustomerId.startsWith('manual:'),
}));

import { createCheckoutSession } from '../src/billing/stripe';

const db = {} as never;
const row = (over: Record<string, unknown>) => ({
  ownerId: 'user_1',
  stripeCustomerId: 'cus_1',
  stripeSubscriptionId: 'sub_1',
  status: 'active',
  ...over,
});

describe('createCheckoutSession for an existing subscriber', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['active', 'trialing', 'past_due'])(
    'sends a %s subscriber to the portal',
    async (status) => {
      m.getSubscription.mockResolvedValue(row({ status }));
      expect(await createCheckoutSession(db, { ownerId: 'user_1', tier: 'pro' })).toBe(
        'https://billing.stripe.test/p',
      );
      expect(m.checkoutCreate).not.toHaveBeenCalled();
    },
  );

  it('lets a canceled subscriber buy again', async () => {
    m.getSubscription.mockResolvedValue(row({ status: 'canceled' }));
    expect(await createCheckoutSession(db, { ownerId: 'user_1', tier: 'pro' })).toBe(
      'https://checkout.stripe.test/s',
    );
    expect(m.portalCreate).not.toHaveBeenCalled();
  });

  it('lets an account with only a linked customer (no subscription yet) check out', async () => {
    m.getSubscription.mockResolvedValue(row({ stripeSubscriptionId: null, status: null }));
    expect(await createCheckoutSession(db, { ownerId: 'user_1', tier: 'pro' })).toBe(
      'https://checkout.stripe.test/s',
    );
  });

  it('lets a brand-new account check out', async () => {
    m.getSubscription.mockResolvedValue(null);
    expect(await createCheckoutSession(db, { ownerId: 'user_1', tier: 'pro' })).toBe(
      'https://checkout.stripe.test/s',
    );
    expect(m.customerCreate).toHaveBeenCalledTimes(1);
  });
});
