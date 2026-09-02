/**
 * A hard spend ceiling for benchmark runs, plus the per-arm cost accounting
 * that falls out of enforcing it.
 *
 * Model participants call provider APIs in a loop with a growing history, so
 * the cost of a run is not knowable in advance — it depends on how many turns
 * each case takes. An estimate is not a limit. This module is the limit.
 *
 * How the ceiling actually holds:
 *
 *   `assertBudget()` runs BEFORE each provider call and refuses when the spend
 *   so far plus RESERVE would breach the cap. It reserves rather than checks
 *   the bare total because a call's cost is only known after it returns — a
 *   check against `spent < limit` would let the very next call overshoot by
 *   its own size. RESERVE is a conservative ceiling on one turn, so the cap is
 *   never exceeded; the tradeoff is that the last ~$0.50 goes unspent.
 *
 * The error it throws is deliberately its own class: the runner retries
 * participant failures, and a budget stop must never be retried, never be
 * mistaken for a model error in the results, and must halt the whole run
 * rather than roll on to the next case.
 *
 * Provider spend only. E2B sandbox time is billed separately and is roughly
 * three orders of magnitude smaller per run.
 */

/** Thrown before a call that would breach the cap. Never retried, always fatal. */
export class BudgetExceededError extends Error {
  constructor(spent: number, limit: number) {
    super(`Budget stop: $${spent.toFixed(4)} spent of $${limit.toFixed(2)} cap (reserving for one more turn)`);
    this.name = 'BudgetExceededError';
  }
}

/**
 * USD per million tokens. A model missing from this table is priced at the
 * most expensive entry rather than free — an unknown model must never be able
 * to spend without bound because nobody updated a lookup table.
 */
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

const FALLBACK_PRICE = { input: 10, output: 50 };

/** Conservative ceiling on one turn: ~50K input + a full 8K max_tokens output. */
const RESERVE_USD = 0.5;

export interface Spend {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  calls: number;
  usd: number;
}

const byParticipant = new Map<string, Spend>();
let limitUsd = Infinity;
let stopped = false;

export function initBudget(limit: number | null): void {
  byParticipant.clear();
  stopped = false;
  limitUsd = limit ?? Infinity;
}

function priceFor(model: string): { input: number; output: number } {
  return PRICES[model] ?? FALLBACK_PRICE;
}

export function totalSpent(): number {
  let sum = 0;
  for (const s of byParticipant.values()) sum += s.usd;
  return sum;
}

export function spendFor(participantId: string): Spend | null {
  return byParticipant.get(participantId) ?? null;
}

export function budgetStopped(): boolean {
  return stopped;
}

export function budgetLimit(): number {
  return limitUsd;
}

/**
 * Refuse the next provider call if paying for it could breach the cap.
 * Call this immediately before the request, not after.
 */
export function assertBudget(): void {
  if (limitUsd === Infinity) return;
  const spent = totalSpent();
  if (spent + RESERVE_USD > limitUsd) {
    stopped = true;
    throw new BudgetExceededError(spent, limitUsd);
  }
}

/**
 * Book one provider response against a participant.
 *
 * `usage` is the provider's own report, so this is measured spend rather than
 * an estimate. Anthropic returns cache token counts separately; they are
 * recorded for visibility but priced at the full input rate, which overstates
 * cost slightly rather than understating it — the safe direction for a cap.
 */
export function recordUsage(
  participantId: string,
  model: string,
  usage: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } | undefined,
): void {
  if (!usage) return;
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cached = usage.cache_read_input_tokens ?? 0;
  const price = priceFor(model);

  const prev = byParticipant.get(participantId) ?? {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    calls: 0,
    usd: 0,
  };
  byParticipant.set(participantId, {
    inputTokens: prev.inputTokens + input,
    outputTokens: prev.outputTokens + output,
    cachedInputTokens: prev.cachedInputTokens + cached,
    calls: prev.calls + 1,
    usd: prev.usd + ((input + cached) * price.input + output * price.output) / 1_000_000,
  });
}

/** One line per arm plus a total, for the end of a run. */
export function formatSpend(): string {
  const rows = [...byParticipant.entries()].map(
    ([id, s]) =>
      `  ${id}: $${s.usd.toFixed(4)} (${s.calls} calls, ${s.inputTokens.toLocaleString()} in / ${s.outputTokens.toLocaleString()} out)`,
  );
  const cap = limitUsd === Infinity ? '' : ` of $${limitUsd.toFixed(2)} cap`;
  return [...rows, `  TOTAL: $${totalSpent().toFixed(4)}${cap}`].join('\n');
}
