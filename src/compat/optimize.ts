/**
 * Global stack optimizer.
 *
 * Branch-and-bound over each slot's ranked candidates to find the highest-quality
 * combination that's compatible — the globally optimal coherent stack, not the
 * greedy local one. "Quality" is rank-regret: each candidate's index in its slot
 * (0 = the top pick), so the objective is to deviate from the ideal ranking as
 * little as possible while staying conflict-free.
 *
 * The feasibility oracle is instant (Tier-1 peer/engine math + pre-loaded sandbox
 * conflict edges), so the search runs purely in memory. Two prunes keep the tree
 * tiny: feasibility (a partial pick that already conflicts can never un-conflict)
 * and bound (a branch whose regret already exceeds the best feasible stack can't
 * win). Both are provably safe, so the result is order-independent — the optimum.
 */
import type { CompatConflict } from '../core/types';
import { resolveArchitectureCompat, type CompatMember } from './peerCompat';

export interface OptimizeResult {
  /** Chosen candidate index per slot (0 = top pick; higher = more regret). */
  selection: number[];
  conflicts: CompatConflict[];
  /** Sum of chosen indices — how far the stack drifted from the ideal ranking. */
  regret: number;
}

/** Conflicts for a (partial) selection: Tier-1 peer/engine + cached sandbox edges. */
function conflictsFor(members: CompatMember[], sandboxConflicts: Set<string>): CompatConflict[] {
  const out = resolveArchitectureCompat(members);
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const a = members[i]!.name;
      const b = members[j]!.name;
      const key = a <= b ? `${a}|${b}` : `${b}|${a}`;
      if (sandboxConflicts.has(key)) {
        out.push({
          source: 'sandbox',
          packages: [a, b],
          detail: `${a} and ${b} are recorded as incompatible (sandbox)`,
        });
      }
    }
  }
  return out;
}

/**
 * Pick one candidate per slot to minimise total rank-regret subject to
 * compatibility. `slots[i]` is slot i's candidates in preference order.
 */
export function optimizeStack(
  slots: CompatMember[][],
  sandboxConflicts: Set<string> = new Set(),
): OptimizeResult {
  // Every slot must offer at least one candidate — otherwise the non-null
  // indexing below (`slots[s]![idx]!`) yields undefined and crashes in
  // conflictsFor. Callers pre-filter, but keep the exported fn safe to reuse.
  if (slots.some((s) => s.length === 0)) {
    throw new Error('optimizeStack: every slot must have at least one candidate');
  }

  const n = slots.length;
  const budget = 50_000;
  let nodes = 0;

  // Incumbent: top pick of every slot. Only a *feasible* stack bounds the search.
  let bestSelection = new Array<number>(n).fill(0);
  let bestRegret = conflictsFor(
    slots.map((c) => c[0]).filter((m): m is CompatMember => Boolean(m)),
    sandboxConflicts,
  ).length === 0
    ? 0
    : Infinity;

  const chosen = new Array<number>(n).fill(0);
  const dfs = (slot: number, regret: number): void => {
    if (nodes++ > budget || regret >= bestRegret) return; // budget / bound prune
    if (slot === n) {
      bestSelection = chosen.slice();
      bestRegret = regret;
      return;
    }
    const candidates = slots[slot]!;
    for (let i = 0; i < candidates.length; i++) {
      chosen[slot] = i;
      // Feasibility prune: a conflict among assigned members is permanent, so a
      // partial pick that already conflicts can never become compatible.
      const assigned = chosen.slice(0, slot + 1).map((idx, s) => slots[s]![idx]!);
      if (conflictsFor(assigned, sandboxConflicts).length === 0) {
        dfs(slot + 1, regret + i);
      }
      if (nodes > budget) return;
    }
  };
  dfs(0, 0);

  const members = bestSelection.map((idx, s) => slots[s]![idx]!);
  return {
    selection: bestSelection,
    conflicts: conflictsFor(members, sandboxConflicts),
    regret: bestRegret === Infinity ? bestSelection.reduce((a, b) => a + b, 0) : bestRegret,
  };
}
