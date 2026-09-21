/**
 * Model identifiers that have a retirement date, and what replaces them.
 *
 * The drift nobody watches. A dependency that moves leaves a version behind in
 * a manifest, where Dependabot can see it. A model identifier is a STRING
 * LITERAL in source — `model: 'claude-3-5-sonnet-20241022'` — so nothing in the
 * dependency toolchain has any idea it is there, let alone that the provider
 * turned it off. The call keeps compiling and starts returning 404 on a date
 * chosen by someone else.
 *
 * That matters more for lurq's users than for most projects: their code is
 * written by coding agents, which emit whichever identifier was current when
 * the model behind them was trained, and never revisit it.
 *
 * THIS TABLE IS POLICY, NOT A FEED. Exactly like `SUPPORTED_NODE_FLOOR` in
 * `upkeepAxes.ts`: a line lurq draws, in one place so moving it is a one-line
 * change. It is not fetched, it does not pretend to be live, and `TABLE_AS_OF`
 * is stamped on every finding so a reader can weigh it. There is no
 * machine-readable retirement endpoint to fetch it from, and inventing a
 * scraper for a table that changes a few times a year is a maintenance burden
 * that buys nothing over bumping a constant.
 *
 * ANTHROPIC ROWS ONLY, and deliberately so. Those dates are sourced. Dates for
 * other providers are not, and this codebase's standing rule is that a fact
 * lurq cannot show its evidence for does not ship — an invented retirement date
 * would make the whole table untrustworthy. `vendor` exists so adding OpenAI or
 * Google rows later is data entry rather than a refactor.
 */

/**
 * When the rows below were last checked against the provider's catalog.
 *
 * Bump it whenever a row changes, and whenever the table is confirmed still
 * correct. It is not decorative: `staleness()` reads it, and a finding from a
 * table nobody has looked at in half a year says so out loud rather than
 * presenting a stale row with the confidence of a fresh one.
 */
export const TABLE_AS_OF = '2026-09-21';

/** How long the table may go unchecked before findings start flagging it. */
export const STALE_AFTER_DAYS = 180;

export type ModelStatus =
  /** The provider has turned it off. A call using it fails now. */
  | 'retired'
  /** Still served, with an announced end date. A call using it works today. */
  | 'deprecated';

export interface TrackedModel {
  /** The exact literal as it appears in source. Matching is exact, never fuzzy. */
  id: string;
  /** Who serves it. Present so a finding can name the provider it came from. */
  vendor: 'anthropic';
  status: ModelStatus;
  /**
   * ISO date. For `retired`, the day it stopped working. For `deprecated`, the
   * announced day it will. `null` when the provider announced a deprecation
   * with no date — a real state, and not the same as "no deprecation".
   */
  date: string | null;
  /**
   * The identifier the provider names as the replacement.
   *
   * A swap to this is the minimum change that makes a retired call run again.
   * It is NOT a claim that behaviour, cost or output are equivalent — they are
   * not — which is why every finding built from it carries `verify: ['tests']`
   * and why nothing here is applied without the diff being seen.
   */
  successor: string;
}

/**
 * Sourced from Anthropic's model catalog on `TABLE_AS_OF`.
 *
 * Keyed by id so a lookup is a map read rather than a scan of every literal in
 * a project against every row — the detector visits every string literal in
 * every source file, so this being O(1) is the difference between a scan that
 * finishes and one that gets switched off.
 */
export const TRACKED_MODELS: ReadonlyMap<string, TrackedModel> = new Map(
  (
    [
      // Retired: these fail today.
      {
        id: 'claude-3-7-sonnet-20250219',
        status: 'retired',
        date: '2026-02-19',
        successor: 'claude-sonnet-5',
      },
      {
        id: 'claude-3-5-haiku-20241022',
        status: 'retired',
        date: '2026-02-19',
        successor: 'claude-haiku-4-5',
      },
      {
        id: 'claude-3-opus-20240229',
        status: 'retired',
        date: '2026-01-05',
        successor: 'claude-opus-5',
      },
      {
        id: 'claude-3-5-sonnet-20241022',
        status: 'retired',
        date: '2025-10-28',
        successor: 'claude-sonnet-5',
      },
      {
        id: 'claude-3-5-sonnet-20240620',
        status: 'retired',
        date: '2025-10-28',
        successor: 'claude-sonnet-5',
      },
      {
        id: 'claude-3-sonnet-20240229',
        status: 'retired',
        date: '2025-07-21',
        successor: 'claude-sonnet-5',
      },
      { id: 'claude-2.1', status: 'retired', date: '2025-07-21', successor: 'claude-sonnet-5' },
      { id: 'claude-2.0', status: 'retired', date: '2025-07-21', successor: 'claude-sonnet-5' },

      // Deprecated: these still work, and have an end date.
      {
        id: 'claude-3-haiku-20240307',
        status: 'deprecated',
        date: '2026-04-19',
        successor: 'claude-haiku-4-5',
      },
      {
        id: 'claude-opus-4-1-20250805',
        status: 'deprecated',
        date: '2026-08-05',
        successor: 'claude-opus-5',
      },
      {
        id: 'claude-opus-4-1',
        status: 'deprecated',
        date: '2026-08-05',
        successor: 'claude-opus-5',
      },
      // Announced with no retirement date yet. `null` is the finding: a reader
      // is told there is no deadline rather than being shown an invented one.
      {
        id: 'claude-sonnet-4-20250514',
        status: 'deprecated',
        date: null,
        successor: 'claude-sonnet-5',
      },
      { id: 'claude-sonnet-4-0', status: 'deprecated', date: null, successor: 'claude-sonnet-5' },
      {
        id: 'claude-opus-4-20250514',
        status: 'deprecated',
        date: null,
        successor: 'claude-opus-5',
      },
      { id: 'claude-opus-4-0', status: 'deprecated', date: null, successor: 'claude-opus-5' },
    ] as const
  ).map((m) => [m.id, { ...m, vendor: 'anthropic' as const }]),
);

/** Whole days from `from` to `to`, negative when `to` is already past. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

/**
 * How long since the table was checked, and whether that is long enough to say
 * so in a finding. Returns `null` when the table is fresh, so a caller appends
 * nothing rather than appending an empty string.
 */
export function staleness(now: Date): string | null {
  const age = daysBetween(new Date(TABLE_AS_OF), now);
  if (age <= STALE_AFTER_DAYS) return null;
  return `lurq's model table was last checked ${age} days ago (${TABLE_AS_OF}), so confirm this against the provider's catalog`;
}
