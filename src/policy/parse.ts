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
import type { AdvisorySeverity, Confidence } from '../core/types';
import type { DenyRule, SelectionPolicy } from './types';

const CONFIDENCES: Confidence[] = ['unproven', 'promising', 'emerging', 'proven'];
const SEVERITIES: AdvisorySeverity[] = ['info', 'low', 'moderate', 'high', 'critical'];

/** Bound on list length and entry size — a policy is hand-written, not generated. */
const MAX_ENTRIES = 500;
const MAX_LEN = 214; // npm's own package-name limit; reasons get the same ceiling.

/**
 * Ceilings on the numeric rules.
 *
 * Not tidiness: these values are written straight into a rule that refuses
 * installs, so an unbounded number is a way to author a policy that blocks the
 * entire index by typo. Nobody ever means a floor of a billion weekly downloads
 * or a zero-KB bundle ceiling.
 */
const LIMITS = {
  minWeeklyDownloads: { min: 0, max: 100_000_000 },
  maxStaleMonths: { min: 1, max: 240 },
  maxBundleKb: { min: 1, max: 100_000 },
} as const;

/**
 * A bounded, finite number, or `null` for "no rule"; `false` means reject.
 *
 * Rejects NaN, Infinity and out-of-range values rather than clamping them —
 * clamping silently saves a rule other than the one that was sent, which is the
 * whole failure mode this parser exists to prevent.
 */
function bounded(input: unknown, limit: { min: number; max: number }): number | null | false {
  if (input === null || input === undefined) return null;
  if (typeof input !== 'number' || !Number.isFinite(input)) return false;
  if (input < limit.min || input > limit.max) return false;
  return input;
}

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

  // Rules added after the first release. `undefined` is accepted and means "no
  // rule" — a client written against the older shape keeps working, and the
  // policy it saves is strictly less restrictive than what it sent, never more.
  if (raw.blockArchived !== undefined && typeof raw.blockArchived !== 'boolean') return null;
  const blockArchived = raw.blockArchived === true;

  let maxAdvisorySeverity: AdvisorySeverity | null = null;
  if (raw.maxAdvisorySeverity !== null && raw.maxAdvisorySeverity !== undefined) {
    if (typeof raw.maxAdvisorySeverity !== 'string') return null;
    if (!SEVERITIES.includes(raw.maxAdvisorySeverity as AdvisorySeverity)) return null;
    maxAdvisorySeverity = raw.maxAdvisorySeverity as AdvisorySeverity;
  }

  const minWeeklyDownloads = bounded(raw.minWeeklyDownloads, LIMITS.minWeeklyDownloads);
  if (minWeeklyDownloads === false) return null;

  const maxStaleMonths = bounded(raw.maxStaleMonths, LIMITS.maxStaleMonths);
  if (maxStaleMonths === false) return null;

  const maxBundleKb = bounded(raw.maxBundleKb, LIMITS.maxBundleKb);
  if (maxBundleKb === false) return null;

  return {
    allow,
    deny,
    minConfidence,
    licenses,
    blockDeprecated: raw.blockDeprecated,
    blockArchived,
    maxAdvisorySeverity,
    minWeeklyDownloads,
    maxStaleMonths,
    maxBundleKb,
  };
}
