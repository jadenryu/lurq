/**
 * Selection policy, applied backwards: which repositories already break it.
 *
 * `enforce.ts` rules on a package an agent is *about to* add. That is the half
 * that prevents new drift from a standard, and it is useless against the code
 * already merged — a team that adopts a licence rule on Tuesday has no way to
 * learn that four services shipped an AGPL parser last spring. This answers
 * that: the same rules, run over every dependency every connected repo already
 * declares.
 *
 * Evaluated on read rather than stored at scan time. A policy edit has to change
 * the answer immediately — a conformance figure computed against a rule that has
 * since been relaxed is worse than no figure, because it reads as current. The
 * cost is one policy row and one keyed lookup over the union of declared names,
 * which is the same order of work as loading the repo list itself.
 *
 * Manifests, not the stored drift detail: `RepoDrift.deps` is capped at
 * REPO_DRIFT_DETAIL_CAP for transport, and ruling on a truncated list would
 * report a clean repo that simply had its violations cut off the end.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { DEFAULT_ECOSYSTEM, type Confidence, type Ecosystem } from '../core/types';
import type { Database } from '../db/client';
import { packages, repos } from '../db/schema';
import { getSelectionPolicy } from '../db/selectionPolicy';
import { declaredDeps } from '../github/drift';
import { check, hasRules } from './enforce';
import type { Exclusion, SelectionPolicy } from './types';

/** Postgres caps bind parameters; chunk the `IN` lists well under it. */
const NAME_CHUNK = 500;

/** Violations carried per repo. The total is always reported separately, so a
 *  truncated list can never be mistaken for the whole finding. */
export const VIOLATION_CAP = 50;

export interface RuleFacts {
  license: string | null;
  deprecated: boolean;
  confidence: Confidence | null;
}

export interface RepoConformance {
  repoId: number;
  fullName: string;
  /** Declared dependencies the rules could be applied to. */
  checked: number;
  /**
   * Declared, but absent from the index — so no rule was applied to them. Never
   * folded into `checked` and never counted as passing: "we did not look" is a
   * different claim from "it is fine", and merging them is the all-clear this
   * codebase refuses everywhere else.
   */
  unchecked: number;
  /**
   * Indexed but carrying no confidence grade, while a `minConfidence` floor is
   * set — so that one rule abstained on them. Zero when no floor is configured.
   * Reported because the alternative is a repo that passes a bar nothing was
   * measured against.
   */
  unscored: number;
  /** Every violation found, which may exceed `violations.length`. */
  total: number;
  violations: Exclusion[];
}

export interface ConformanceReport {
  /**
   * Whether any rule was in force. False means nothing was evaluated — an empty
   * `repos` list under `enforcing: false` says "no policy set", and rendering it
   * as a clean bill of health would be a lie the UI tells on our behalf.
   */
  enforcing: boolean;
  repos: RepoConformance[];
}

/** license / deprecated / confidence for the named packages, keyed by name. */
async function loadRuleFacts(
  db: Database,
  names: string[],
  ecosystem: Ecosystem = DEFAULT_ECOSYSTEM,
): Promise<Map<string, RuleFacts>> {
  const out = new Map<string, RuleFacts>();
  for (let i = 0; i < names.length; i += NAME_CHUNK) {
    const rows = await db
      .select({
        name: packages.name,
        license: packages.license,
        deprecated: packages.deprecated,
        confidence: packages.confidence,
      })
      .from(packages)
      .where(
        and(
          inArray(packages.name, names.slice(i, i + NAME_CHUNK)),
          eq(packages.ecosystem, ecosystem),
        ),
      );
    for (const row of rows) {
      out.set(row.name, {
        license: row.license,
        deprecated: row.deprecated,
        confidence: row.confidence,
      });
    }
  }
  return out;
}

/**
 * Rule one repo's declared dependencies. Pure — names and facts in, counts and
 * violations out — because the abstention rules are the part worth testing
 * exhaustively and a database makes that expensive.
 */
export function ruleRepo(
  policy: SelectionPolicy,
  names: string[],
  facts: Map<string, RuleFacts>,
): Omit<RepoConformance, 'repoId' | 'fullName'> {
  const violations: Exclusion[] = [];
  let checked = 0;
  let unchecked = 0;
  let unscored = 0;

  for (const name of names) {
    const fact = facts.get(name);
    // An unindexed package has no confidence grade and no licence on record, so
    // no rule can honestly convict or clear it.
    if (!fact) {
      unchecked += 1;
      continue;
    }
    checked += 1;
    if (policy.minConfidence !== null && fact.confidence === null) unscored += 1;
    const exclusion = check(
      policy,
      // `check` needs a grade and an unscored package has none. The top grade
      // makes the confidence floor abstain rather than convict on a fact never
      // established — "absent facts never convict", in enforce.ts — while the
      // licence and deprecation rules still apply normally. The abstention is
      // counted above rather than hidden.
      { name, confidence: fact.confidence ?? 'proven' },
      { license: fact.license, deprecated: fact.deprecated },
    );
    if (exclusion) violations.push(exclusion);
  }

  return {
    checked,
    unchecked,
    unscored,
    total: violations.length,
    violations: violations.slice(0, VIOLATION_CAP),
  };
}

/** Worst first: most violations, then most unruled, then alphabetical. */
function bySeverity(a: RepoConformance, z: RepoConformance): number {
  return z.total - a.total || z.unchecked - a.unchecked || a.fullName.localeCompare(z.fullName);
}

/**
 * Every connected repo, ruled against the owner's selection policy.
 *
 * Scoped by `ownerId` like every other repo read — the policy and the repos it
 * judges belong to the same account, and there is deliberately no unscoped form.
 */
export async function repoConformance(
  db: Database,
  ownerId: string,
): Promise<ConformanceReport> {
  const policy = await getSelectionPolicy(db, ownerId);
  // No rules means no work: skip the repo and package reads entirely rather than
  // computing an empty answer expensively.
  if (!hasRules(policy)) return { enforcing: false, repos: [] };

  const rows = await db
    .select({ id: repos.id, fullName: repos.fullName, manifests: repos.manifests })
    .from(repos)
    .where(eq(repos.ownerId, ownerId));
  if (!rows.length) return { enforcing: true, repos: [] };

  const declaredPerRepo = rows.map((r) => ({
    repoId: r.id,
    fullName: r.fullName,
    names: [...declaredDeps(r.manifests ?? []).keys()],
  }));

  // One lookup for the union across every repo: a monorepo fleet shares most of
  // its dependencies, so per-repo queries would re-read the same rows N times.
  const union = [...new Set(declaredPerRepo.flatMap((r) => r.names))];
  const facts = await loadRuleFacts(db, union);

  const report = declaredPerRepo.map(({ repoId, fullName, names }) => ({
    repoId,
    fullName,
    ...ruleRepo(policy, names, facts),
  }));

  return { enforcing: true, repos: report.sort(bySeverity) };
}
