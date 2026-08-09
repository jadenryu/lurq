/**
 * Apply a selection policy to a candidate list.
 *
 * Pure: candidates and facts in, allowed and excluded out. No database, no
 * clock — the rules are the part worth testing exhaustively, and a pure function
 * is the only version of them that can be.
 */
import type { Candidate, Confidence } from '../core/types';
import type { Exclusion, PolicyFacts, SelectionPolicy } from './types';

/** Ordering for the `minConfidence` floor. Mirrors search/recommend. */
const CONFIDENCE_RANK: Record<Confidence, number> = {
  unproven: 0,
  promising: 1,
  emerging: 2,
  proven: 3,
};

/**
 * Does this policy actually rule on anything?
 *
 * The free path — no policy configured — must not pay for an extra query per
 * recommendation, and this is what lets the handler skip the fact lookup
 * entirely. `licenses: []` counts as a rule even though it allows nothing;
 * treating it as "no rule" would silently ignore a policy someone saved.
 */
export function hasRules(policy: SelectionPolicy): boolean {
  return (
    policy.deny.length > 0 ||
    policy.minConfidence !== null ||
    policy.licenses !== null ||
    policy.blockDeprecated
  );
}

export interface PolicyResult {
  allowed: Candidate[];
  excluded: Exclusion[];
}

/**
 * Split candidates into what the agent may use and what it may not.
 *
 * Order is preserved: the ranking upstream is the product of relevance and
 * evidence, and policy is a filter over it, never a re-rank.
 */
export function applyPolicy(
  policy: SelectionPolicy,
  candidates: Candidate[],
  facts: Map<string, PolicyFacts>,
): PolicyResult {
  const allowed: Candidate[] = [];
  const excluded: Exclusion[] = [];

  for (const candidate of candidates) {
    const exclusion = check(policy, candidate, facts.get(candidate.name));
    if (exclusion) excluded.push(exclusion);
    else allowed.push(candidate);
  }

  return { allowed, excluded };
}

/**
 * Evaluate one candidate. Returns the exclusion, or null when it passes.
 *
 * Rule order is deliberate: `allow` first, so an explicit exception always wins;
 * then `deny`, so a human's block beats every inferred rule; then the inferred
 * rules in descending severity. A package that trips several rules is reported
 * under the one a person would consider most serious, because the reason is what
 * the agent acts on and a list of four is a list it will summarise badly.
 */
export function check(
  policy: SelectionPolicy,
  // Structural, not `Candidate`: the rules read a name and an evidence grade and
  // nothing else, so `evaluate` can pass its own row without inventing the rest
  // of a Candidate to satisfy a type. Candidate still satisfies this shape.
  pkg: { name: string; confidence: Confidence },
  facts: PolicyFacts | undefined,
): Exclusion | null {
  const { name } = pkg;

  if (policy.allow.includes(name)) return null;

  const denied = policy.deny.find((d) => d.name === name);
  if (denied) {
    return {
      name,
      rule: 'denied',
      reason: denied.reason ?? "Blocked by your organisation's selection policy.",
    };
  }

  // Absent facts never convict. An unindexed license cannot fail a license
  // rule — that turns "we didn't look" into a refusal, which is the same lie as
  // turning it into an all-clear, just pointed the other way.
  if (policy.blockDeprecated && facts?.deprecated) {
    return { name, rule: 'deprecated', reason: 'Marked deprecated on npm.' };
  }

  if (policy.licenses && facts?.license && !policy.licenses.includes(facts.license)) {
    return {
      name,
      rule: 'license',
      reason: `License ${facts.license} is not in the allowed set (${policy.licenses.join(', ')}).`,
    };
  }

  if (policy.minConfidence) {
    if (CONFIDENCE_RANK[pkg.confidence] < CONFIDENCE_RANK[policy.minConfidence]) {
      return {
        name,
        rule: 'confidence',
        reason: `Evidence is ${pkg.confidence}; your policy requires ${policy.minConfidence} or better.`,
      };
    }
  }

  return null;
}
