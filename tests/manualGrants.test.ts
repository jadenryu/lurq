import { describe, expect, it } from 'vitest';
import { grantLapsed, isManualGrant, manualCustomerId } from '../src/db/subscriptions';

/** Only the fields the gate reads. */
const row = (stripeCustomerId: string, currentPeriodEnd: Date | null) =>
  ({ stripeCustomerId, currentPeriodEnd }) as never;

const NOW = new Date('2026-06-01T00:00:00Z');
const PAST = new Date('2026-05-31T23:59:59Z');
const FUTURE = new Date('2026-07-01T00:00:00Z');

describe('manual grant marking', () => {
  it('round-trips an owner id through the synthetic customer id', () => {
    const id = manualCustomerId('user_2abc');
    expect(isManualGrant({ stripeCustomerId: id })).toBe(true);
  });

  it('does not mistake a real Stripe customer for a grant', () => {
    expect(isManualGrant({ stripeCustomerId: 'cus_QxyzManual' })).toBe(false);
  });
});

describe('grantLapsed (the expiry gate)', () => {
  it('lapses a manual grant once its end date passes', () => {
    expect(grantLapsed(row(manualCustomerId('user_2abc'), PAST), NOW)).toBe(true);
  });

  it('keeps serving a manual grant before its end date', () => {
    expect(grantLapsed(row(manualCustomerId('user_2abc'), FUTURE), NOW)).toBe(false);
  });

  it('never date-gates a Stripe-backed row', () => {
    // Stripe says when a subscription ends. Gating on the date too would drop a
    // paying customer for the minutes between a renewal and its webhook.
    expect(grantLapsed(row('cus_Qxyz', PAST), NOW)).toBe(false);
  });

  it('treats a grant with no end date as unexpired rather than crashing', () => {
    // Should not occur: grantPlan always sets one. Belt and braces, because the
    // wrong direction here silently cuts off a paying account.
    expect(grantLapsed(row(manualCustomerId('user_2abc'), null), NOW)).toBe(false);
  });
});
