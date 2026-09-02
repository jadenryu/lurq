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
    // A negative would credit the ledger and hand back budget that was spent.
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
