/**
 * Read/write helpers for selection policy, plus the package facts enforcement
 * needs.
 *
 * Same authorization rule as db/repos: every query is scoped by `ownerId`, and
 * there is deliberately no unscoped read. A policy leak is worse than a repo
 * leak — it discloses what a company has decided to ban and why.
 */
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Database } from './client';
import { packages, policyDecisions, selectionPolicies, selectionPolicyChanges } from './schema';
import { DEFAULT_ECOSYSTEM, type Ecosystem } from '../core/types';
import { diffPolicies, withoutExpired } from '../policy/enforce';
import {
  DEFAULT_SELECTION_POLICY,
  type AllowRule,
  type Exclusion,
  type PolicyFacts,
  type SelectionPolicy,
} from '../policy/types';

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
  if (!row) return DEFAULT_SELECTION_POLICY;
  const stored = { ...DEFAULT_SELECTION_POLICY, ...row.policy };
  // Rows saved before exceptions carried a reason or expiry hold bare names.
  // Normalised here so no reader downstream has to know both shapes existed.
  const allow = (stored.allow as (AllowRule | string)[]).map((a) =>
    typeof a === 'string' ? { name: a } : a,
  );
  return { ...stored, allow };
}

/**
 * The policy as enforcement applies it right now: lapsed exceptions removed.
 *
 * Every enforcement path reads through this; `GET /policy` and the dashboard
 * read `getSelectionPolicy`, so an expired exception stays visible (and in a
 * pulled file) until someone deletes it on purpose.
 */
export async function getEnforcedPolicy(
  db: Database,
  ownerId: string | null,
): Promise<SelectionPolicy> {
  return withoutExpired(await getSelectionPolicy(db, ownerId), new Date());
}

/**
 * Create or replace the owner's policy, and record the change. Returns the
 * policy it replaced.
 *
 * `actor` is `dashboard` or the pushing key's display prefix. The write and its
 * history row commit together: a policy change with no record of who made it is
 * exactly the gap an audit trail exists to close.
 * ponytail: `previous` is read outside the transaction, so two saves racing for
 * one owner can record a stale `before`; lock the row if concurrent writers show up.
 */
export async function setSelectionPolicy(
  db: Database,
  ownerId: string,
  policy: SelectionPolicy,
  actor: string,
): Promise<SelectionPolicy> {
  const previous = await getSelectionPolicy(db, ownerId);
  await db.transaction(async (tx) => {
    await tx
      .insert(selectionPolicies)
      .values({ ownerId, policy, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: selectionPolicies.ownerId,
        set: { policy, updatedAt: new Date() },
      });
    await tx
      .insert(selectionPolicyChanges)
      .values({ ownerId, actor, before: previous, after: policy });
  });
  return previous;
}

export interface PolicyChange {
  actor: string;
  at: Date;
  /** `-`/`+` rule sentences, see diffPolicies. */
  changes: string[];
  before: SelectionPolicy;
  after: SelectionPolicy;
}

/** The owner's policy changes, newest first. */
export async function listPolicyChanges(
  db: Database,
  ownerId: string,
  limit = 20,
): Promise<PolicyChange[]> {
  const rows = await db
    .select()
    .from(selectionPolicyChanges)
    .where(eq(selectionPolicyChanges.ownerId, ownerId))
    .orderBy(desc(selectionPolicyChanges.createdAt), desc(selectionPolicyChanges.id))
    .limit(limit);
  return rows.map((row) => ({
    actor: row.actor,
    at: row.createdAt,
    changes: diffPolicies(row.before, row.after),
    before: row.before,
    after: row.after,
  }));
}

/**
 * Log what a rule refused (or, in warn mode, would have).
 *
 * Fire-and-forget, the same idiom as recordUsage: a log write must never fail
 * the tool call an agent is waiting on.
 */
export async function recordDecisions(
  db: Database,
  ownerId: string | null,
  tool: string,
  exclusions: Exclusion[],
  action: 'blocked' | 'warned',
): Promise<void> {
  if (!ownerId || exclusions.length === 0) return;
  try {
    await db
      .insert(policyDecisions)
      .values(
        exclusions.map((e) => ({ ownerId, packageName: e.name, rule: e.rule, action, tool })),
      );
  } catch {
    // Display-only log: never let it break the request.
  }
}

export interface DecisionSummary {
  packageName: string;
  rule: Exclusion['rule'];
  action: 'blocked' | 'warned';
  count: number;
  /** UTC day of the most recent hit, YYYY-MM-DD. */
  lastDay: string;
}

/**
 * Refusals grouped by package, rule and action over a trailing window, busiest
 * first. Grouped rather than raw: an agent retrying the same blocked package
 * twenty times is one finding, and the question being answered is "what is this
 * policy catching", not "replay every call".
 */
export async function summarizeDecisions(
  db: Database,
  ownerId: string,
  days: number,
): Promise<DecisionSummary[]> {
  const count = sql<number>`count(*)::int`;
  return db
    .select({
      packageName: policyDecisions.packageName,
      rule: policyDecisions.rule,
      action: policyDecisions.action,
      count,
      lastDay: sql<string>`to_char(max(${policyDecisions.createdAt}) at time zone 'UTC', 'YYYY-MM-DD')`,
    })
    .from(policyDecisions)
    .where(
      and(
        eq(policyDecisions.ownerId, ownerId),
        // `::int` for the same reason usage.ts's windowStart casts: an uncast JS
        // number leaves Postgres to guess the operand type.
        gte(policyDecisions.createdAt, sql`now() - make_interval(days => ${days}::int)`),
      ),
    )
    .groupBy(policyDecisions.packageName, policyDecisions.rule, policyDecisions.action)
    .orderBy(desc(count))
    .limit(100);
}

/** Whole days from `date` to now; null when the date is unknown. */
export function daysSince(date: Date | null): number | null {
  if (!date) return null;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24)));
}

/** Whole months from `date` to now; null when the date is unknown. */
function monthsSince(date: Date | null): number | null {
  if (!date) return null;
  const ms = Date.now() - date.getTime();
  if (ms < 0) return 0;
  return Math.floor(ms / (1000 * 60 * 60 * 24 * 30.44));
}

/**
 * Every package fact the selection rules read, for the named packages.
 *
 * Kept out of the search queries on purpose. Adding these columns to both legs of
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
  ecosystem: Ecosystem = DEFAULT_ECOSYSTEM,
): Promise<Map<string, PolicyFacts>> {
  const out = new Map<string, PolicyFacts>();
  if (names.length === 0) return out;
  const rows = await db
    .select({
      name: packages.name,
      license: packages.license,
      deprecated: packages.deprecated,
      archived: packages.archived,
      advisories: packages.advisories,
      weeklyDownloads: packages.weeklyDownloads,
      lastReleaseAt: packages.lastReleaseAt,
      bundleMinGzipKb: packages.bundleMinGzipKb,
      firstPublishedAt: packages.firstPublishedAt,
    })
    .from(packages)
    .where(and(inArray(packages.name, names), eq(packages.ecosystem, ecosystem)));
  for (const row of rows) {
    out.set(row.name, {
      license: row.license,
      deprecated: row.deprecated,
      archived: row.archived,
      advisories: row.advisories,
      weeklyDownloads: row.weeklyDownloads,
      // Resolved here, not in `check`: the rules stay a pure function with no
      // clock, which is what lets every one of them be tested exhaustively.
      monthsSinceRelease: monthsSince(row.lastReleaseAt),
      bundleKb: row.bundleMinGzipKb,
      daysSincePublished: daysSince(row.firstPublishedAt),
    });
  }
  return out;
}
