import type { RepoPolicy } from "@/lib/lurq-issuer";

/**
 * A policy is a permission grant, so it is validated in the web layer as well
 * as in the backend. Rejecting a partial object rather than merging it means a
 * malformed request can never arm a repo the user meant to leave off.
 *
 * Shared by the per-repo route and the account-default route: a second copy is
 * how the two drift, and this parser is the reason a granted check survives the
 * trip. The route gets the request first, so fixing the backend's parser alone
 * would not close a hole here.
 */
export function parsePolicy(input: unknown): RepoPolicy | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  if (typeof raw.enabled !== "boolean" || typeof raw.autoMerge !== "boolean") return null;
  if (raw.scope !== "security" && raw.scope !== "blocking" && raw.scope !== "all") return null;
  // Carried through, not rebuilt: rebuilding a three-key policy here strips a
  // granted check in transit — the save succeeds, the toggle looks like it
  // worked, and nothing runs.
  const checks = parseChecks(raw.checks);
  return {
    enabled: raw.enabled,
    scope: raw.scope,
    autoMerge: raw.autoMerge,
    ...(checks ? { checks } : {}),
  };
}

/** Absent or malformed reads as not granted. An explicit false and a missing
 *  key mean the same thing, so only a granted check is forwarded. */
function parseChecks(input: unknown): RepoPolicy["checks"] | null {
  if (!input || typeof input !== "object") return null;
  return { env: (input as Record<string, unknown>).env === true };
}
