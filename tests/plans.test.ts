import { describe, expect, it } from 'vitest';
import {
  PLANS,
  PLAN_LIST,
  ANNUAL_DISCOUNT,
  OVERAGE_CAP_MULTIPLE,
  annualPriceCents,
  billedSeats,
  isServed,
  monthlyAllowance,
  overageCalls,
  planFor,
  quotaState,
  type Tier,
} from '../src/core/plans';

describe('seats and the pooled allowance', () => {
  it('bills a per-seat plan at no fewer than its minimum', () => {
    expect(billedSeats(PLANS.team, 1)).toBe(3);
    expect(billedSeats(PLANS.team, null)).toBe(3);
    expect(billedSeats(PLANS.team, 8)).toBe(8);
  });

  it('ignores seats on flat plans', () => {
    // A Pro row carrying a stray quantity must not multiply its allowance.
    expect(billedSeats(PLANS.pro, 12)).toBe(1);
    expect(monthlyAllowance(PLANS.pro, 12)).toBe(PLANS.pro.monthlyCalls);
  });

  it('pools calls across seats and leaves uncapped uncapped', () => {
    expect(monthlyAllowance(PLANS.team, 8)).toBe(8 * PLANS.team.monthlyCalls!);
    expect(monthlyAllowance(PLANS.enterprise, 50)).toBeNull();
  });

  it('keeps CI policy keys and the long decision log off the individual plans', () => {
    expect(PLANS.free.ciPolicyKeys).toBe(false);
    expect(PLANS.pro.ciPolicyKeys).toBe(false);
    expect(PLANS.team.ciPolicyKeys).toBe(true);
    const days = PLAN_LIST.map((p) => p.decisionLogDays);
    expect(days).toEqual([...days].sort((a, b) => a - b));
  });
});

describe('annual prices', () => {
  it('charges twelve months less the discount', () => {
    expect(ANNUAL_DISCOUNT).toBe(0.2);
    expect(annualPriceCents(PLANS.pro)).toBe(14_400); // $12/mo
    expect(annualPriceCents(PLANS.team)).toBe(24_000); // $20/seat/mo
  });
});

describe('quotaState and overage', () => {
  it('is within quota under the pool, and uncapped always is', () => {
    expect(quotaState(1_000, 999, false)).toEqual({ withinQuota: true, inOverage: false });
    expect(quotaState(null, 10_000_000, false)).toEqual({ withinQuota: true, inOverage: false });
  });

  it('serves overage past the pool only when the subscription is metered', () => {
    expect(quotaState(1_000, 1_000, false).inOverage).toBe(false);
    expect(quotaState(1_000, 1_000, true).inOverage).toBe(true);
  });

  it('stops overage at the ceiling, so a runaway loop cannot bill without bound', () => {
    const ceiling = 1_000 * OVERAGE_CAP_MULTIPLE;
    expect(quotaState(1_000, ceiling - 1, true).inOverage).toBe(true);
    expect(quotaState(1_000, ceiling, true).inOverage).toBe(false);
  });

  it('bills only calls past the pool, capped at the ceiling', () => {
    expect(overageCalls(1_000, 800)).toBe(0);
    expect(overageCalls(1_000, 1_250)).toBe(250);
    expect(overageCalls(1_000, 50_000)).toBe(1_000 * (OVERAGE_CAP_MULTIPLE - 1));
    expect(overageCalls(null, 50_000)).toBe(0);
  });
});

describe('planFor (entitlement resolution)', () => {
  it('resolves each known tier', () => {
    for (const tier of ['free', 'pro', 'team', 'enterprise'] as Tier[]) {
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

    // Zero would read as "no limit" in the web route, so free must be positive.
    const ask = PLAN_LIST.map((p) => p.askDailyUsd);
    expect(ask[0]!).toBeGreaterThan(0);
    for (let i = 1; i < ask.length; i++) expect(ask[i]!).toBeGreaterThan(ask[i - 1]!);
  });

  it('keeps free free and paid paid', () => {
    expect(PLANS.free.paid).toBe(false);
    expect(PLANS.free.priceCents).toBe(0);
    expect(PLANS.pro.paid).toBe(true);
    expect(PLANS.team.paid).toBe(true);
    expect(PLANS.enterprise.paid).toBe(true);
  });

  it('leaves exactly one tier uncapped, and it is the top one', () => {
    const uncapped = PLAN_LIST.filter((p) => p.monthlyCalls === null);
    expect(uncapped).toHaveLength(1);
    expect(uncapped[0]!.tier).toBe('enterprise');
  });
});
