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

/** The recommended successor for a superseded package, or null if it isn't one. */
export function lookupSuccessor(name: string): Successor | null {
  const hit = MAP[name.toLowerCase()];
  return hit ? { name: hit.replacedBy, reason: hit.reason } : null;
}
