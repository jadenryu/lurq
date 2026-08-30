import { describe, expect, it } from 'vitest';
import { PLANS, PLAN_LIST, isServed, planFor, type Tier } from '../src/core/plans';

describe('planFor (entitlement resolution)', () => {
  it('resolves each known tier', () => {
    for (const tier of ['free', 'pro', 'enterprise'] as Tier[]) {
      expect(planFor(tier).tier).toBe(tier);
    }
  });

  it('falls back to free for anything unknown, never to unlimited', () => {
    // The direction of this fallback is the whole point: a corrupt tier string
    // must not hand out Enterprise.
    for (const bad of [null, undefined, '', 'admin', 'ENTERPRISE', 'pro ']) {
      expect(planFor(bad).tier).toBe('free');
      expect(planFor(bad).monthlyCalls).not.toBeNull();
    }
  });
});

describe('isServed (which Stripe statuses keep working)', () => {
  it('serves active and trialing', () => {
    expect(isServed('active')).toBe(true);
    expect(isServed('trialing')).toBe(true);
  });

  it('keeps serving past_due — a failed charge is dunning, not a cutoff', () => {
    // Stripe retries for days before moving a subscription to canceled. Cutting
    // service on the first failed charge turns an expired card into a churn.
    expect(isServed('past_due')).toBe(true);
  });

  it('stops serving once the subscription is genuinely over', () => {
    for (const s of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused']) {
      expect(isServed(s)).toBe(false);
    }
    expect(isServed(null)).toBe(false);
    expect(isServed(undefined)).toBe(false);
  });
});

describe('the plan table itself', () => {
  it('is ordered cheapest first, and prices ascend with it', () => {
    const prices = PLAN_LIST.map((p) => p.priceCents);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it('gives every paid tier strictly more allowance than the one below', () => {
    // A paid plan that buys no more calls than the free one is a pricing bug
    // that reads as fine on the page.
    const calls = PLAN_LIST.map((p) => p.monthlyCalls ?? Infinity);
    for (let i = 1; i < calls.length; i++) expect(calls[i]!).toBeGreaterThan(calls[i - 1]!);

    const rates = PLAN_LIST.map((p) => p.ratePerMinute);
    for (let i = 1; i < rates.length; i++) expect(rates[i]!).toBeGreaterThan(rates[i - 1]!);
  });

  it('keeps free free and paid paid', () => {
    expect(PLANS.free.paid).toBe(false);
    expect(PLANS.free.priceCents).toBe(0);
    expect(PLANS.pro.paid).toBe(true);
    expect(PLANS.enterprise.paid).toBe(true);
  });

  it('leaves exactly one tier uncapped, and it is the top one', () => {
    const uncapped = PLAN_LIST.filter((p) => p.monthlyCalls === null);
    expect(uncapped).toHaveLength(1);
    expect(uncapped[0]!.tier).toBe('enterprise');
  });
});
