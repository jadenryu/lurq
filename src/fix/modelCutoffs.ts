/**
 * When each model's knowledge stops being reliable.
 *
 * This is the input to `lurq stale`: an agent trained to date D believes the
 * API that was current at D. Everything a package removed after D is something
 * the agent will still reach for, confidently, and get wrong.
 *
 * ANTHROPIC ROWS ONLY, and for the same reason `modelIds.ts` gives: these dates
 * are published, so lurq can show its evidence. A cutoff invented for a model
 * whose vendor never stated one would be a guess presented as a measurement,
 * which is the failure this whole product exists to catch. Other models are
 * supported through `--since`, where the date is the caller's claim, not ours.
 *
 * RELIABLE KNOWLEDGE CUTOFF, not training data cutoff. Anthropic publishes both
 * and they differ — Haiku 4.5 reads Feb 2025 against a Jul 2025 training cutoff.
 * The docs define the reliable date as the one "through which the model's
 * knowledge is most extensive and reliable", which is the question here: not
 * what the model glimpsed, but what it can be trusted to remember correctly.
 *
 * Source: https://platform.claude.com/docs/en/docs/about-claude/models/overview
 */

/** The day the table below was read from the source above. */
export const CUTOFFS_AS_OF = '2026-09-22';

/**
 * How long before the table should be distrusted.
 *
 * Models ship faster than lurq releases. A six-month-old table will be missing
 * the model the caller is actually using, and the honest response to that is to
 * say so rather than silently answer for a model we do not know. Mirrors
 * `STALE_AFTER_DAYS` in modelIds.ts.
 */
export const CUTOFFS_STALE_AFTER_DAYS = 180;

export interface ModelCutoff {
  /** Claude API model ID, as the docs spell it. */
  id: string;
  /** ISO year-month. Day precision is not published, so none is implied. */
  reliableKnowledge: string;
  /** Published alongside it, and deliberately not what lurq uses — see above. */
  trainingData: string;
}

export const MODEL_CUTOFFS: ReadonlyMap<string, ModelCutoff> = new Map(
  (
    [
      { id: 'claude-fable-5-1', reliableKnowledge: '2026-06', trainingData: '2026-06' },
      { id: 'claude-opus-5-5', reliableKnowledge: '2026-06', trainingData: '2026-06' },
      { id: 'claude-sonnet-5', reliableKnowledge: '2026-01', trainingData: '2026-01' },
      { id: 'claude-haiku-4-5', reliableKnowledge: '2025-02', trainingData: '2025-07' },
    ] satisfies ModelCutoff[]
  ).map((m) => [m.id, m]),
);

/** Days since the table was refreshed, for the staleness warning. */
export function cutoffTableAgeDays(now: Date = new Date()): number {
  const asOf = Date.parse(`${CUTOFFS_AS_OF}T00:00:00Z`);
  return Math.floor((now.getTime() - asOf) / 86_400_000);
}

export function cutoffTableIsStale(now: Date = new Date()): boolean {
  return cutoffTableAgeDays(now) > CUTOFFS_STALE_AFTER_DAYS;
}

/**
 * Turn `--model` / `--since` into the date the comparison runs against.
 *
 * `--since` wins when both are given: an explicit date is the caller stating a
 * fact about their own setup, and a table shipped in a release should never
 * override that.
 *
 * A month resolves to its FIRST day. The published cutoffs have month
 * precision, and taking the last day would claim the model knows about releases
 * published in the back half of a month that lurq has no evidence it saw.
 * Erring early makes the answer a floor: every symbol reported is one the model
 * really is behind on.
 */
export function resolveSince(opts: {
  model?: string;
  since?: string;
}): { date: string; basis: string } | { error: string } {
  if (opts.since) {
    const normalized = /^\d{4}-\d{2}$/.test(opts.since) ? `${opts.since}-01` : opts.since;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(Date.parse(normalized))) {
      return { error: `--since must be YYYY-MM or YYYY-MM-DD, got "${opts.since}".` };
    }
    return { date: normalized, basis: 'the date you gave' };
  }
  if (!opts.model) {
    return { error: 'Pass --model <id> or --since <YYYY-MM>.' };
  }
  const found = MODEL_CUTOFFS.get(opts.model);
  if (!found) {
    const known = [...MODEL_CUTOFFS.keys()].join(', ');
    return {
      error:
        `No published knowledge cutoff on file for "${opts.model}".\n` +
        `  Known: ${known}\n` +
        `  For any other model, pass --since <YYYY-MM> with its cutoff.`,
    };
  }
  return {
    date: `${found.reliableKnowledge}-01`,
    basis: `${found.id}'s reliable knowledge cutoff (${found.reliableKnowledge})`,
  };
}
