import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import { subscriptionItems } from '../src/billing/stripe';

const item = (id: string, usage: 'licensed' | 'metered', quantity?: number) =>
  ({
    id,
    quantity,
    price: { id: `price_${id}`, recurring: { usage_type: usage } },
  }) as unknown as Stripe.SubscriptionItem;

const sub = (...items: Stripe.SubscriptionItem[]) =>
  ({ items: { data: items } }) as unknown as Pick<Stripe.Subscription, 'items'>;

describe('subscriptionItems', () => {
  it('reads the licensed item as the plan even when the metered one comes first', () => {
    // Stripe does not order items. Taking [0] here would price-match the metered
    // overage Price and miss the plan entirely.
    const { item: plan, overageEnabled } = subscriptionItems(
      sub(item('overage', 'metered'), item('team', 'licensed', 8)),
    );
    expect(plan?.price.id).toBe('price_team');
    expect(plan?.quantity).toBe(8);
    expect(overageEnabled).toBe(true);
  });

  it('reports no overage on a plain subscription', () => {
    const { item: plan, overageEnabled } = subscriptionItems(sub(item('pro', 'licensed', 1)));
    expect(plan?.price.id).toBe('price_pro');
    expect(overageEnabled).toBe(false);
  });

  it('survives a subscription with no items', () => {
    expect(subscriptionItems(sub())).toEqual({ item: undefined, overageEnabled: false });
  });
});
