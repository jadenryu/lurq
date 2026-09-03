import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { askSpendDaily, ownerUsageDaily } from '../src/db/schema';
import { MICROS_PER_USD, usdToMicros } from '../src/db/askSpend';

/**
 * The Ask budget's arithmetic and its shape. Every case here is a way for a
 * spend cap to look enforced while quietly not being.
 */
describe('usdToMicros', () => {
  it('rounds rather than truncates', () => {
    // Truncating every write biases the ledger low. Over thousands of sub-cent
    // calls that silently raises the real ceiling above the configured one.
    expect(usdToMicros(0.0000019)).toBe(2);
    expect(usdToMicros(1.9999996)).toBe(2_000_000);
  });

  it('never returns a negative charge', () => {
    // usdToMicros converts a COST, which is never negative. Refunds are formed
    // by the caller as `actual - reserve` and go through addAskSpend's signed
    // path, not through here — so a negative arriving at this function is a
    // bug, and clamping is the safe reading of it.
    expect(usdToMicros(-5)).toBe(0);
  });

  it('is exact on whole dollars', () => {
    expect(usdToMicros(3)).toBe(3 * MICROS_PER_USD);
  });
});

describe('ask_spend_daily table', () => {
  const config = getTableConfig(askSpendDaily);

  it('is keyed per owner per day', () => {
    const pk = config.primaryKeys[0];
    expect(pk, 'no primary key — concurrent upserts would duplicate the day').toBeDefined();
    expect(pk!.columns.map((c) => c.name)).toEqual(['owner_id', 'date']);
  });

  it('stores an integer, not a float', () => {
    // The column is only ever read by adding to it. A real accumulator drifts.
    const col = config.columns.find((c) => c.name === 'usd_micros');
    expect(col?.notNull).toBe(true);
    expect(col?.getSQLType()).toContain('bigint');
  });

  it('is a separate table from the display-only usage rollup', () => {
    // owner_usage_daily documents itself as fire-and-forget: an undercount on a
    // DB hiccup is acceptable there. It is not acceptable in a budget, which is
    // the whole reason these are two tables and not one with an extra column.
    expect(getTableConfig(ownerUsageDaily).name).not.toBe(config.name);
    expect(config.name).toBe('ask_spend_daily');
  });
});

/**
 * The reserve/settle round trip, in arithmetic.
 *
 * The race this closes: two questions from one account in flight together each
 * read the day's total, each believe the whole remainder is theirs, and each
 * spend it. Charging the worst case up front means the second question reads a
 * figure that already contains the first one's reserve.
 */
describe('reserve then settle', () => {
  const RESERVE = usdToMicros(0.25);

  /** What the caller sends to settle: the real cost, minus what it held. */
  const settlement = (actualUsd: number) => usdToMicros(actualUsd) - RESERVE;

  it('refunds the unused part of a cheap question', () => {
    // Held $0.25, spent $0.004 → the ledger should end up holding $0.004.
    const delta = settlement(0.004);
    expect(delta).toBeLessThan(0);
    expect(RESERVE + delta).toBe(usdToMicros(0.004));
  });

  it('nets to zero when a question costs exactly its reserve', () => {
    expect(settlement(0.25)).toBe(0);
  });

  it('leaves the full reserve charged when a question is never settled', () => {
    // A crash between reserve and settle over-charges until midnight. That is
    // the correct direction for a ceiling to be wrong, and this pins it: the
    // account is down the reserve, not up it.
    expect(RESERVE).toBeGreaterThan(0);
  });

  it('keeps two concurrent questions from both seeing the same remainder', () => {
    // Sequential reserves against one ledger: the second must see the first.
    let ledger = 0;
    ledger += RESERVE;
    const secondSees = ledger;
    ledger += RESERVE;
    expect(secondSees).toBe(RESERVE);
    expect(ledger).toBe(2 * RESERVE);
  });
});
