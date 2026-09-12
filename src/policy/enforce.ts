/**
 * Apply a selection policy to a candidate list.
 *
 * Pure: candidates and facts in, allowed and excluded out. No database, no
 * clock — the rules are the part worth testing exhaustively, and a pure function
 * is the only version of them that can be.
 */
import type { Advisory, AdvisorySeverity, Candidate, Confidence } from '../core/types';
import type { Exclusion, PolicyFacts, SelectionPolicy } from './types';

/** Ordering for the `minConfidence` floor. Mirrors search/recommend. */
const CONFIDENCE_RANK: Record<Confidence, number> = {
  unproven: 0,
  promising: 1,
  emerging: 2,
  proven: 3,
};

/**
 * Worst tolerated → blocked. Ranked so `maxAdvisorySeverity: 'moderate'` reads
 * as "moderate is fine, high and critical are not", which is how the rule is
 * phrased in the UI and how teams say it out loud.
 */
const SEVERITY_RANK: Record<AdvisorySeverity, number> = {
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
};

/** The worst advisory on a package, or null when it carries none. */
function worst(advisories: Advisory[] | null | undefined): Advisory | null {
  if (!advisories?.length) return null;
  return advisories.reduce((a, b) =>
    SEVERITY_RANK[b.severity] > SEVERITY_RANK[a.severity] ? b : a,
  );
}

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
    policy.blockDeprecated ||
    policy.blockArchived ||
    policy.maxAdvisorySeverity !== null ||
    policy.minWeeklyDownloads !== null ||
    policy.maxStaleMonths !== null ||
    policy.maxBundleKb !== null
  );
}

/**
 * One sentence per active rule, most severe first — what an agent reads before
 * it picks. Empty when nothing is enforced: an allowlist on its own exempts
 * packages from rules that do not exist, so it is not worth a line.
 */
export function describeRules(policy: SelectionPolicy): string[] {
  if (!hasRules(policy)) return [];
  const out: string[] = [];
  if (policy.allow.length) out.push(`Always allowed, whatever else applies: ${policy.allow.join(', ')}.`);
  for (const d of policy.deny) out.push(`Never use ${d.name}${d.reason ? `: ${d.reason}` : '.'}`);
  if (policy.maxAdvisorySeverity) {
    out.push(`No packages with a known advisory above ${policy.maxAdvisorySeverity}.`);
  }
  if (policy.licenses) {
    out.push(
      policy.licenses.length
        ? `Licenses allowed: ${policy.licenses.join(', ')}.`
        : 'No license is allowed, so every package with a known license is refused.',
    );
  }
  if (policy.blockDeprecated) out.push('No deprecated packages.');
  if (policy.blockArchived) out.push('No packages whose repository is archived.');
  if (policy.minConfidence) out.push(`lurq confidence must be ${policy.minConfidence} or better.`);
  if (policy.minWeeklyDownloads !== null) {
    out.push(`At least ${policy.minWeeklyDownloads.toLocaleString('en-US')} weekly downloads.`);
  }
  if (policy.maxStaleMonths !== null) {
    out.push(`A release within the last ${policy.maxStaleMonths} months.`);
  }
  if (policy.maxBundleKb !== null) out.push(`Bundle size at most ${policy.maxBundleKb} KB min+gzip.`);
  return out;
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
  // turning it into an all-clear, just pointed the other way. Every rule below
  // reads its fact through `?.` plus a null check for exactly that reason.

  // Security first: a known vulnerability outranks every judgement call under
  // it. A package that is also deprecated, huge and stale is still reported as
  // the security problem, because that is the one the agent must not route
  // around.
  if (policy.maxAdvisorySeverity) {
    const hit = worst(facts?.advisories);
    if (hit && SEVERITY_RANK[hit.severity] > SEVERITY_RANK[policy.maxAdvisorySeverity]) {
      return {
        name,
        rule: 'advisory',
        reason: `Known ${hit.severity} advisory (${hit.id}): ${hit.summary}. Your policy allows ${policy.maxAdvisorySeverity} and below.`,
      };
    }
  }

  if (policy.blockDeprecated && facts?.deprecated) {
    return { name, rule: 'deprecated', reason: 'Marked deprecated on npm.' };
  }

  if (policy.blockArchived && facts?.archived) {
    return {
      name,
      rule: 'archived',
      reason: 'Its source repository is archived, so nothing will be fixed upstream.',
    };
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

  // Adoption, staleness and size are the three judgement calls, ordered by how
  // strong a claim each one makes. Downloads say "nobody else runs this"; a
  // release gap says "nobody is minding it"; size says "it costs more than it is
  // worth" — the weakest of the three, so it is reported last.
  if (
    policy.minWeeklyDownloads !== null &&
    facts?.weeklyDownloads != null &&
    facts.weeklyDownloads < policy.minWeeklyDownloads
  ) {
    return {
      name,
      rule: 'adoption',
      reason: `${facts.weeklyDownloads.toLocaleString('en-US')} weekly downloads is below your floor of ${policy.minWeeklyDownloads.toLocaleString('en-US')}.`,
    };
  }

  if (
    policy.maxStaleMonths !== null &&
    facts?.monthsSinceRelease != null &&
    facts.monthsSinceRelease > policy.maxStaleMonths
  ) {
    return {
      name,
      rule: 'stale',
      reason: `Last release was ${facts.monthsSinceRelease} months ago; your policy allows ${policy.maxStaleMonths}.`,
    };
  }

  if (policy.maxBundleKb !== null && facts?.bundleKb != null && facts.bundleKb > policy.maxBundleKb) {
    return {
      name,
      rule: 'size',
      reason: `${facts.bundleKb.toFixed(1)} KB min+gzip exceeds your ceiling of ${policy.maxBundleKb} KB.`,
    };
  }

  return null;
}
