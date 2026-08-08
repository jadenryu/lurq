/**
 * Blame paths: which direct dependency pulls a transitive one in.
 *
 * Without this, a transitive advisory tells you *what* but not what to do — you
 * can see `minimist@1.2.5` is flagged and have no idea which of your own
 * dependencies is responsible. Walking the DEPENDS_ON graph upward turns that
 * into "upgrade eslint", which is an action.
 *
 * The whole module is written around one distinction: **"nothing pulls this in"
 * is never a true answer.** Every node in a resolved tree got there somehow. So
 * an empty result always means the graph could not tell us, and it is reported
 * as unattributed rather than as an absence of parents.
 */
import type { DependencyEdge, ResolvedDep } from './sbom';

/**
 * Depth bound for the upward walk. Real npm trees nest deeply and contain
 * cycles; this caps the work per node without changing the answer for anything
 * a human would act on.
 */
const MAX_DEPTH = 24;

export interface AttributionIndex {
  /** True when the document carried usable DEPENDS_ON edges at all. */
  available: boolean;
  /** Direct dependency names reachable *above* a given package name. */
  parentsOf: Map<string, string[]>;
}

/**
 * Build the reverse index once per scan, then answer every risk from it.
 *
 * Done as one pass rather than a walk per risky package: a tree with thousands
 * of nodes and a hundred flagged packages would otherwise re-traverse the same
 * subgraphs a hundred times.
 */
export function buildAttribution(
  deps: ResolvedDep[],
  edges: DependencyEdge[],
  directNames: Set<string>,
): AttributionIndex {
  if (edges.length === 0) return { available: false, parentsOf: new Map() };

  // SPDX ids are the edge vocabulary; names are what anyone can act on.
  const nameOf = new Map<string, string>();
  for (const dep of deps) {
    if (dep.spdxId) nameOf.set(dep.spdxId, dep.name);
  }

  // child id → parent ids. The SBOM gives parent → child; attribution walks up.
  const parentIds = new Map<string, string[]>();
  for (const edge of edges) {
    const list = parentIds.get(edge.child);
    if (list) list.push(edge.parent);
    else parentIds.set(edge.child, [edge.parent]);
  }

  // An SBOM whose only edges come from the document root gives every package the
  // same non-informative parent. Detect that and report it as unavailable rather
  // than attributing every transitive to a repo node nobody can upgrade.
  const informative = edges.some(
    (edge) => nameOf.has(edge.parent) && nameOf.has(edge.child),
  );
  if (!informative) return { available: false, parentsOf: new Map() };

  const parentsOf = new Map<string, string[]>();

  for (const dep of deps) {
    if (!dep.spdxId || directNames.has(dep.name)) continue;

    const roots = new Set<string>();
    const seen = new Set<string>([dep.spdxId]);
    let frontier = [dep.spdxId];

    for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const parent of parentIds.get(id) ?? []) {
          if (seen.has(parent)) continue; // npm graphs contain cycles
          seen.add(parent);
          const parentName = nameOf.get(parent);
          if (parentName && directNames.has(parentName)) {
            // A direct dependency: stop climbing this branch. Anything above it
            // is the repo itself, which is not an upgrade target.
            roots.add(parentName);
            continue;
          }
          next.push(parent);
        }
      }
      frontier = next;
    }

    if (roots.size > 0) {
      parentsOf.set(dep.name, [...roots].sort());
    }
  }

  return { available: true, parentsOf };
}
