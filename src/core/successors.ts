/**
 * Deprecation → replacement map (§1.2). Agents confidently recommend dead
 * packages (moment, request, …) because their training data froze when those
 * were popular; lurq's freshness is exactly the corrective. This is the curated
 * seed the roadmap calls for — a small, high-confidence set of genuinely
 * superseded packages. Later this graph is learned from outcome data (§3.1);
 * for now it's hand-verified so `evaluate` never steers an agent wrong.
 */
import successors from '../data/successors.json';

export interface Successor {
  /** The package to migrate to. */
  name: string;
  /** Why the original is dead and this replaces it. */
  reason: string;
}

const MAP = successors as Record<string, { replacedBy: string; reason: string }>;

/**
 * Successions derived from outcome history, keyed by the superseded package.
 * Built by `buildLearnedSuccessors` and passed in rather than imported, so this
 * module stays pure and synchronous — the DB read belongs to the caller.
 */
export type LearnedSuccessors = Map<string, Successor>;

/**
 * The recommended successor for a superseded package, or null if it isn't one.
 *
 * The curated map wins every collision. It is hand-verified, and the learned
 * layer is a statistical read of what other people did — when the two disagree
 * about a package we have deliberately checked, the check is worth more than the
 * crowd. Learned entries exist to cover the ecosystem the curated 13 never will,
 * not to overrule them.
 */
export function lookupSuccessor(name: string, learned?: LearnedSuccessors): Successor | null {
  const key = name.toLowerCase();
  const curated = MAP[key];
  if (curated) return { name: curated.replacedBy, reason: curated.reason };
  return learned?.get(key) ?? null;
}

/**
 * Shape observed successions into successor entries.
 *
 * Two guards beyond the owner threshold enforced in the query:
 *
 * · Only packages the index knows to be dead get a learned successor. A healthy
 *   package that someone happened to swap out is a preference, not a succession,
 *   and telling every agent that React "was replaced by" something because three
 *   teams changed their minds is exactly the false authority this map must not
 *   acquire.
 * · One winner per superseded package — the most-observed. Reporting a tie as
 *   two successors gives an agent a choice it has no basis to make.
 */
export function buildLearnedSuccessors(
  observed: { from: string; to: string; owners: number; observations: number }[],
  isSuperseded: (name: string) => boolean,
): LearnedSuccessors {
  const best = new Map<string, { to: string; owners: number; observations: number }>();

  for (const row of observed) {
    if (!isSuperseded(row.from)) continue;
    const key = row.from.toLowerCase();
    const current = best.get(key);
    // Owners first, observations as the tiebreak: breadth of agreement is
    // harder to manufacture than volume from a few accounts.
    const better =
      !current ||
      row.owners > current.owners ||
      (row.owners === current.owners && row.observations > current.observations);
    if (better) best.set(key, { to: row.to, owners: row.owners, observations: row.observations });
  }

  return new Map(
    [...best].map(([from, hit]) => [
      from,
      {
        name: hit.to,
        reason: `${hit.owners} teams moved here after ${from} failed for the same need`,
      },
    ]),
  );
}
