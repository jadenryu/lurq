/**
 * Parse untrusted JSON into a SelectionPolicy.
 *
 * A policy is a permission grant, so this rejects rather than repairs. Merging a
 * partial object over the default would let a malformed request silently drop a
 * rule someone is relying on — the failure mode is a package quietly becoming
 * installable again, which nobody would notice until it shipped.
 *
 * The one exception is `null` for `minConfidence` and `licenses`, which is a
 * meaningful value ("no rule") rather than a missing one.
 */
import type { Confidence } from '../core/types';
import type { DenyRule, SelectionPolicy } from './types';

const CONFIDENCES: Confidence[] = ['unproven', 'promising', 'emerging', 'proven'];

/** Bound on list length and entry size — a policy is hand-written, not generated. */
const MAX_ENTRIES = 500;
const MAX_LEN = 214; // npm's own package-name limit; reasons get the same ceiling.

function names(input: unknown): string[] | null {
  if (!Array.isArray(input) || input.length > MAX_ENTRIES) return null;
  const out: string[] = [];
  for (const item of input) {
    if (typeof item !== 'string') return null;
    const name = item.trim();
    if (!name || name.length > MAX_LEN) return null;
    out.push(name);
  }
  return out;
}

function denyRules(input: unknown): DenyRule[] | null {
  if (!Array.isArray(input) || input.length > MAX_ENTRIES) return null;
  const out: DenyRule[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') return null;
    const raw = item as Record<string, unknown>;
    if (typeof raw.name !== 'string') return null;
    const name = raw.name.trim();
    if (!name || name.length > MAX_LEN) return null;
    if (raw.reason === undefined || raw.reason === null) {
      out.push({ name });
      continue;
    }
    if (typeof raw.reason !== 'string' || raw.reason.length > MAX_LEN) return null;
    const reason = raw.reason.trim();
    out.push(reason ? { name, reason } : { name });
  }
  return out;
}

export function parseSelectionPolicy(input: unknown): SelectionPolicy | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;

  const allow = names(raw.allow);
  if (!allow) return null;

  const deny = denyRules(raw.deny);
  if (!deny) return null;

  if (typeof raw.blockDeprecated !== 'boolean') return null;

  let minConfidence: Confidence | null = null;
  if (raw.minConfidence !== null && raw.minConfidence !== undefined) {
    if (typeof raw.minConfidence !== 'string') return null;
    if (!CONFIDENCES.includes(raw.minConfidence as Confidence)) return null;
    minConfidence = raw.minConfidence as Confidence;
  }

  // `null` and `[]` are different policies: no rule at all, versus an allowlist
  // that permits nothing. Collapsing them would turn a saved empty allowlist
  // into an unenforced one.
  let licenses: string[] | null = null;
  if (raw.licenses !== null && raw.licenses !== undefined) {
    licenses = names(raw.licenses);
    if (!licenses) return null;
  }

  return { allow, deny, minConfidence, licenses, blockDeprecated: raw.blockDeprecated };
}
