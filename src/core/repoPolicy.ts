/**
 * The one parser for an autopilot policy, shared by every hop it takes.
 *
 * A policy is a permission grant, and it crosses three boundaries on the way to
 * storage: the web route, the issuer route, and the row itself. Each hop used to
 * parse it again with its own copy, and the copies drifted the moment a field
 * was added — `mode` landed in two of them, `checks` in two others. The failure
 * is silent in the worst way: the save succeeds, the toggle looks like it
 * worked, and the setting is simply gone, because `setRepoPolicy` REPLACES the
 * stored policy wholesale rather than merging into it.
 *
 * Lives under `core` because that is the only directory the web app can import
 * (`@lurq/core/*`), which is what makes one parser possible at all.
 */
import { type RepoPolicy } from '../github/types';

/**
 * Reject anything not matching RepoPolicy rather than merging partial input: a
 * half-parsed policy could arm a repo the user meant to leave off.
 */
export function parseRepoPolicy(input: unknown): RepoPolicy | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  if (typeof raw.enabled !== 'boolean') return null;
  if (typeof raw.autoMerge !== 'boolean') return null;
  if (raw.scope !== 'security' && raw.scope !== 'blocking' && raw.scope !== 'all') return null;
  const checks = parseChecks(raw.checks);
  const mode =
    raw.mode === 'comment' || raw.mode === 'fix' || raw.mode === 'pr' ? raw.mode : null;
  // Spread rather than assigned: an absent optional must stay absent. Writing
  // `mode: undefined` puts the key in the JSON column, and `policy.mode ?? 'pr'`
  // then reads a stored null where it expects nothing.
  return {
    enabled: raw.enabled,
    scope: raw.scope,
    autoMerge: raw.autoMerge,
    ...(checks ? { checks } : {}),
    ...(mode ? { mode } : {}),
  };
}

/**
 * Absent or malformed reads as not granted, never as a permissive default.
 * An explicit `false` and a missing key mean the same thing, so only a granted
 * check is stored.
 */
function parseChecks(input: unknown): RepoPolicy['checks'] | null {
  if (!input || typeof input !== 'object') return null;
  return { env: (input as Record<string, unknown>).env === true };
}
