import { describe, expect, it } from 'vitest';
import { isEntitled } from '../src/db/subscriptions';
import type { SubscriptionRow } from '../src/db/schema';

const NOW = new Date('2026-06-15T12:00:00Z');
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

function row(over: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    ownerId: 'user_1',
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    tier: 'pro',
    status: 'active',
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    manualNote: null,
    lastEventAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as SubscriptionRow;
}

describe('isEntitled — hand-granted plans', () => {
  it('serves a grant that has not run out', () => {
    expect(isEntitled(row({ currentPeriodEnd: days(10) }), NOW)).toBe(true);
  });

  it('stops serving one that has', () => {
    // The whole reason the end date is enforced for manual grants: nothing else
    // will ever tell us this customer stopped paying.
    expect(isEntitled(row({ currentPeriodEnd: days(-1) }), NOW)).toBe(false);
  });

  it('treats the exact expiry moment as over, not as still valid', () => {
    expect(isEntitled(row({ currentPeriodEnd: NOW }), NOW)).toBe(false);
  });

  it('still honours a revoke regardless of the date', () => {
    expect(isEntitled(row({ status: 'canceled', currentPeriodEnd: days(30) }), NOW)).toBe(false);
  });
});

describe('isEntitled — Stripe-backed subscriptions', () => {
  const stripeRow = (over: Partial<SubscriptionRow> = {}) =>
    row({ stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', ...over });

  it('does NOT lapse on a stale period end', () => {
    // Stripe says when a subscription ends. Gating on the date too would drop a
    // paying customer to free for the minutes between a renewal and its webhook.
    expect(isEntitled(stripeRow({ currentPeriodEnd: days(-1) }), NOW)).toBe(true);
  });

  it('keeps serving past_due, as the status rule says', () => {
    expect(isEntitled(stripeRow({ status: 'past_due', currentPeriodEnd: days(-3) }), NOW)).toBe(
      true,
    );
  });

  it('stops when Stripe says it is cancelled', () => {
    expect(isEntitled(stripeRow({ status: 'canceled', currentPeriodEnd: days(30) }), NOW)).toBe(
      false,
    );
  });
});

describe('isEntitled — a grant with no end date', () => {
  it('is open-ended, which is why the CLI will not create one', () => {
    // grantPlan always writes an end date; this documents that the guard is the
    // command's, so nobody later "simplifies" --months away without noticing.
    expect(isEntitled(row({ currentPeriodEnd: null }), NOW)).toBe(true);
  });
});
