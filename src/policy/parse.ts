/**
 * Parse untrusted JSON into a SelectionPolicy.
 *
 * A policy is a permission grant, so this rejects rather than repairs. Merging a
 * partial object over the default would let a malformed request silently drop a
 * rule someone is relying on — the failure mode is a package quietly becoming
 * installable again, which nobody would notice until it shipped.
 *
 * The one exception is `null` for the optional rules, which is a meaningful
 * value ("no rule") rather than a missing one.
 *
 * Rejections name the field and what was wrong with it. A policy is now a file
 * people edit by hand and push from CI, and "not a valid policy" on a 60-line
 * file sends them hunting.
 */
import type { AdvisorySeverity, Confidence } from '../core/types';
import type { AllowRule, DenyRule, PolicyMode, SelectionPolicy } from './types';

const CONFIDENCES: readonly Confidence[] = ['unproven', 'promising', 'emerging', 'proven'];
const SEVERITIES: readonly AdvisorySeverity[] = ['info', 'low', 'moderate', 'high', 'critical'];
const MODES: readonly PolicyMode[] = ['enforce', 'warn'];

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
  minPackageAgeDays: { min: 1, max: 365 },
} as const;

class Invalid extends Error {}

function fail(message: string): never {
  throw new Invalid(message);
}

/**
 * A bounded, finite number, or `null` for "no rule".
 *
 * Rejects NaN, Infinity and out-of-range values rather than clamping them —
 * clamping silently saves a rule other than the one that was sent, which is the
 * whole failure mode this parser exists to prevent.
 */
function bounded(input: unknown, field: keyof typeof LIMITS): number | null {
  if (input === null || input === undefined) return null;
  const { min, max } = LIMITS[field];
  if (typeof input !== 'number' || !Number.isFinite(input) || input < min || input > max) {
    fail(`${field} must be a number from ${min} to ${max}, or null for no rule.`);
  }
  return input;
}

function oneOf<T extends string>(input: unknown, field: string, options: readonly T[]): T | null {
  if (input === null || input === undefined) return null;
  if (!options.includes(input as T)) {
    fail(`${field} must be one of ${options.join(', ')}, or null for no rule.`);
  }
  return input as T;
}

function list(input: unknown, field: string): unknown[] {
  if (!Array.isArray(input)) fail(`${field} must be a list.`);
  if (input.length > MAX_ENTRIES) fail(`${field} has more than ${MAX_ENTRIES} entries.`);
  return input;
}

function name(input: unknown, where: string): string {
  if (typeof input !== 'string') fail(`${where} must be a string.`);
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > MAX_LEN) fail(`${where} must be 1 to ${MAX_LEN} characters.`);
  return trimmed;
}

/** A trimmed reason, or undefined when absent or blank — a blank one is not stored. */
function reason(input: unknown, where: string): string | undefined {
  if (input === null || input === undefined) return undefined;
  if (typeof input !== 'string' || input.length > MAX_LEN) {
    fail(`${where}.reason must be text of at most ${MAX_LEN} characters.`);
  }
  return input.trim() || undefined;
}

function entry(input: unknown, where: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail(`${where} must be an object with a name.`);
  }
  return input as Record<string, unknown>;
}

function denyRules(input: unknown): DenyRule[] {
  return list(input, 'deny').map((item, i) => {
    const raw = entry(item, `deny[${i}]`);
    const rule: DenyRule = { name: name(raw.name, `deny[${i}].name`) };
    const why = reason(raw.reason, `deny[${i}]`);
    return why ? { ...rule, reason: why } : rule;
  });
}

function allowRules(input: unknown): AllowRule[] {
  return list(input, 'allow').map((item, i) => {
    const where = `allow[${i}]`;
    // A bare name is how exceptions were saved before they carried a reason or
    // an expiry. Still accepted, so an older client and older files keep working.
    if (typeof item === 'string') return { name: name(item, where) };
    const raw = entry(item, where);
    const rule: AllowRule = { name: name(raw.name, `${where}.name`) };
    const why = reason(raw.reason, where);
    if (why) rule.reason = why;
    if (raw.expires !== null && raw.expires !== undefined) {
      // Round-tripped through Date so 2026-02-31 is refused rather than read as
      // March 3rd. ISO form is required because enforcement compares as strings.
      const valid =
        typeof raw.expires === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(raw.expires) &&
        !Number.isNaN(Date.parse(raw.expires)) &&
        new Date(raw.expires).toISOString().slice(0, 10) === raw.expires;
      if (!valid) fail(`${where}.expires must be a date like 2026-12-31.`);
      rule.expires = raw.expires as string;
    }
    return rule;
  });
}

function build(input: unknown): SelectionPolicy {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    fail('policy must be an object.');
  const raw = input as Record<string, unknown>;

  const allow = allowRules(raw.allow);
  const deny = denyRules(raw.deny);

  if (typeof raw.blockDeprecated !== 'boolean') fail('blockDeprecated must be true or false.');

  // `null` and `[]` are different policies: no rule at all, versus an allowlist
  // that permits nothing. Collapsing them would turn a saved empty allowlist
  // into an unenforced one.
  const licenses =
    raw.licenses === null || raw.licenses === undefined
      ? null
      : list(raw.licenses, 'licenses').map((item, i) => name(item, `licenses[${i}]`));

  // Fields added after the first release. `undefined` is accepted and means the
  // least restrictive reading — no rule, or enforce for `mode`, which is what a
  // policy meant before the field existed. An older client keeps working.
  if (raw.blockArchived !== undefined && typeof raw.blockArchived !== 'boolean') {
    fail('blockArchived must be true or false.');
  }
  if (raw.mode !== undefined && !MODES.includes(raw.mode as PolicyMode)) {
    fail(`mode must be ${MODES.join(' or ')}.`);
  }

  return {
    mode: (raw.mode as PolicyMode | undefined) ?? 'enforce',
    allow,
    deny,
    minConfidence: oneOf(raw.minConfidence, 'minConfidence', CONFIDENCES),
    licenses,
    blockDeprecated: raw.blockDeprecated,
    blockArchived: raw.blockArchived === true,
    maxAdvisorySeverity: oneOf(raw.maxAdvisorySeverity, 'maxAdvisorySeverity', SEVERITIES),
    minWeeklyDownloads: bounded(raw.minWeeklyDownloads, 'minWeeklyDownloads'),
    maxStaleMonths: bounded(raw.maxStaleMonths, 'maxStaleMonths'),
    maxBundleKb: bounded(raw.maxBundleKb, 'maxBundleKb'),
    minPackageAgeDays: bounded(raw.minPackageAgeDays, 'minPackageAgeDays'),
  };
}

/** The policy, or the first thing wrong with it, in words a person can fix. */
export function validateSelectionPolicy(
  input: unknown,
): { policy: SelectionPolicy } | { error: string } {
  try {
    return { policy: build(input) };
  } catch (err) {
    if (err instanceof Invalid) return { error: err.message };
    throw err;
  }
}

export function parseSelectionPolicy(input: unknown): SelectionPolicy | null {
  const result = validateSelectionPolicy(input);
  return 'policy' in result ? result.policy : null;
}
