/**
 * Read/write helpers for selection policy, plus the package facts enforcement
 * needs.
 *
 * Same authorization rule as db/repos: every query is scoped by `ownerId`, and
 * there is deliberately no unscoped read. A policy leak is worse than a repo
 * leak — it discloses what a company has decided to ban and why.
 */
import { eq, inArray } from 'drizzle-orm';
import type { Database } from './client';
import { packages, selectionPolicies } from './schema';
import { DEFAULT_SELECTION_POLICY, type SelectionPolicy, type PolicyFacts } from '../policy/types';

/**
 * The owner's policy, or the default when they have never set one.
 *
 * A null owner (anonymous or operator-issued key) gets the default rather than
 * an error: an unauthenticated caller has no organisation whose rules could
 * apply, and failing the whole recommendation over a missing policy would take
 * the free tier down with it.
 */
export async function getSelectionPolicy(
  db: Database,
  ownerId: string | null,
): Promise<SelectionPolicy> {
  if (!ownerId) return DEFAULT_SELECTION_POLICY;
  const [row] = await db
    .select({ policy: selectionPolicies.policy })
    .from(selectionPolicies)
    .where(eq(selectionPolicies.ownerId, ownerId))
    .limit(1);
  // Merged over the default so a policy written before a rule existed does not
  // arrive with that field undefined — the enforcement code reads `null` as
  // "no rule" and `undefined` would slip past those checks unevaluated.
  return row ? { ...DEFAULT_SELECTION_POLICY, ...row.policy } : DEFAULT_SELECTION_POLICY;
}

/** Create or replace the owner's policy. */
export async function setSelectionPolicy(
  db: Database,
  ownerId: string,
  policy: SelectionPolicy,
): Promise<void> {
  await db
    .insert(selectionPolicies)
    .values({ ownerId, policy, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: selectionPolicies.ownerId,
      set: { policy, updatedAt: new Date() },
    });
}

/**
 * License and deprecation for the named packages.
 *
 * Kept out of the search queries on purpose. Adding two columns to both legs of
 * the hybrid retrieval would widen the hot path for every caller so that policy
 * — which most callers do not have — could read them. One keyed lookup over at
 * most five names is cheaper than that, and it keeps search unaware of policy.
 *
 * Names missing from the result are simply absent from the map. Enforcement
 * treats an absent fact as "not established", never as a violation.
 */
export async function loadPolicyFacts(
  db: Database,
  names: string[],
): Promise<Map<string, PolicyFacts>> {
  const out = new Map<string, PolicyFacts>();
  if (names.length === 0) return out;
  const rows = await db
    .select({
      name: packages.name,
      license: packages.license,
      deprecated: packages.deprecated,
    })
    .from(packages)
    .where(inArray(packages.name, names));
  for (const row of rows) {
    out.set(row.name, { license: row.license, deprecated: row.deprecated });
  }
  return out;
}
