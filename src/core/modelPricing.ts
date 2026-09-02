/**
 * What a model call costs, in USD.
 *
 * Pulled out of any one caller because two of them now need it and they enforce
 * different things: the benchmark caps a whole run and halts fatally when it
 * would overshoot, while the dashboard's Ask caps one account's rolling spend
 * and degrades to a message. Those are different policies over the same
 * arithmetic, and the arithmetic is the part that must not disagree — a price
 * table that drifts between two files is a budget that quietly stops holding.
 *
 * The one rule worth stating: an unrecognised model is priced at the most
 * expensive entry, never at zero. A lookup nobody remembered to update must
 * never be the reason something spends without bound.
 */

/** USD per million tokens. */
const PRICES: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-fable-5': { input: 10, output: 50 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

/** Priced as the dearest model on the list, so an unknown id cannot be free. */
const FALLBACK = { input: 10, output: 50 };

export interface TokenUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  /** Written to cache at ~1.25x the input rate. */
  cache_creation_input_tokens?: number | null;
  /** Served from cache at ~0.1x the input rate — the whole point of caching. */
  cache_read_input_tokens?: number | null;
}

/**
 * Cost of one call. Cached reads are billed at a tenth of the input rate and
 * cache writes at a quarter over it; counting either as plain input would
 * overstate a cached conversation by roughly an order of magnitude and make the
 * caching look like it did nothing.
 */
export function costOf(model: string, usage: TokenUsage): number {
  const p = PRICES[model] ?? FALLBACK;
  const m = 1_000_000;
  return (
    ((usage.input_tokens ?? 0) * p.input +
      (usage.cache_creation_input_tokens ?? 0) * p.input * 1.25 +
      (usage.cache_read_input_tokens ?? 0) * p.input * 0.1 +
      (usage.output_tokens ?? 0) * p.output) /
    m
  );
}

/**
 * A conservative ceiling on what one more turn could cost, for reserve-before-
 * call checks. Callers reserve rather than compare against the bare total,
 * because a call's price is only known after it returns — checking
 * `spent < limit` lets the very next call overshoot by its own size.
 */
export function reserveFor(model: string, maxTokens: number): number {
  const p = PRICES[model] ?? FALLBACK;
  // Assume the output cap is reached and the input is a full large context.
  return (200_000 * p.input + maxTokens * p.output) / 1_000_000;
}
