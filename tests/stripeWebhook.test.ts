/**
 * The Stripe webhook's status contract. It used to answer 200 before processing,
 * so a failure was a lost upgrade Stripe never retried. What matters to Stripe
 * is only the status: 2xx stops delivery, anything else retries.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  handleEvent: vi.fn(),
  getSubscriptionByCustomer: vi.fn(),
  alert: vi.fn(),
}));

vi.mock('../src/billing/stripe', () => ({
  constructEvent: m.constructEvent,
  handleEvent: m.handleEvent,
}));
vi.mock('../src/db/subscriptions', () => ({ getSubscriptionByCustomer: m.getSubscriptionByCustomer }));
vi.mock('../src/core/alert', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/core/alert')>()),
  alert: m.alert,
}));

import { processStripeWebhook } from '../src/billing/webhook';

const db = {} as never;
const raw = Buffer.from('{"id":"evt_1"}');
const event = {
  id: 'evt_1',
  type: 'customer.subscription.updated',
  created: 1_760_000_000,
  data: { object: { customer: 'cus_1' } },
};

describe('processStripeWebhook', () => {
  const onPlanChanged = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    m.constructEvent.mockResolvedValue(event);
    m.handleEvent.mockResolvedValue('customer.subscription.updated: customer cus_1 → pro (active)');
    m.getSubscriptionByCustomer.mockResolvedValue({ ownerId: 'user_1' });
  });

  it('answers 200 only after the event is applied, and drops the cached plan', async () => {
    const reply = await processStripeWebhook(db, raw, 'sig', onPlanChanged);
    expect(reply).toEqual({ status: 200, body: { received: true } });
    expect(m.handleEvent).toHaveBeenCalledWith(db, event);
    expect(onPlanChanged).toHaveBeenCalledWith('user_1');
  });

  it('answers 5xx when processing throws, so Stripe retries, and alerts without the message', async () => {
    m.handleEvent.mockRejectedValue(new Error('connection terminated (password=hunter2)'));
    const reply = await processStripeWebhook(db, raw, 'sig', onPlanChanged);
    expect(reply.status).toBe(500);
    expect(onPlanChanged).not.toHaveBeenCalled();
    expect(m.alert).toHaveBeenCalledTimes(1);
    const [kind, detail] = m.alert.mock.calls[0] as [string, string];
    expect(kind).toBe('stripe-webhook');
    expect(detail).toContain('evt_1');
    expect(detail).not.toContain('hunter2');
  });

  it('answers 5xx when the post-apply read fails, since a redelivery is harmless', async () => {
    m.getSubscriptionByCustomer.mockRejectedValue(new Error('timeout'));
    expect((await processStripeWebhook(db, raw, 'sig', onPlanChanged)).status).toBe(500);
  });

  it('answers 200 to a duplicate delivery, including one the guard drops as superseded', async () => {
    const first = await processStripeWebhook(db, raw, 'sig', onPlanChanged);
    m.handleEvent.mockResolvedValueOnce('customer.subscription.updated: superseded by a newer event, dropped');
    const second = await processStripeWebhook(db, raw, 'sig', onPlanChanged);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(m.handleEvent).toHaveBeenCalledTimes(2);
  });

  it('rejects a bad signature with 400 and never processes it', async () => {
    m.constructEvent.mockRejectedValue(new Error('No signatures found matching the expected signature'));
    const reply = await processStripeWebhook(db, raw, 'bad', onPlanChanged);
    expect(reply.status).toBe(400);
    expect(m.handleEvent).not.toHaveBeenCalled();
    expect(m.alert).not.toHaveBeenCalled();
  });

  it('verifies against the raw bytes it was given', async () => {
    await processStripeWebhook(db, raw, 'sig', onPlanChanged);
    expect(m.constructEvent).toHaveBeenCalledWith(raw, 'sig');
  });

  it('404s when billing or the webhook secret is not configured', async () => {
    m.constructEvent.mockResolvedValue(null);
    expect(await processStripeWebhook(db, raw, undefined, onPlanChanged)).toEqual({ status: 404 });
  });
});
