/**
 * Lurq-plan benchmark participant.
 *
 * Calls `handlePlan` with the fixture's pre-decomposed `needs[]` (zero-LLM
 * path). Maps each returned PlanSlot back to the fixture's needId by exact
 * `slot.need === need.need` text comparison.
 *
 * This is structural: loadCases guarantees unique need text within a case,
 * and the plan input is the fixture array verbatim — the returned slot text
 * is always an exact echo.
 */
import type { Database } from '../../db/client';
import { handlePlan, type PlanOutput } from '../../mcp/plan';
import type {
  BenchmarkCase,
  Participant,
  ProposedSelection,
  StackProposal,
} from '../types';

export class LurqPlanParticipant implements Participant {
  readonly id = 'lurq-plan';
  readonly kind = 'lurq' as const;
  readonly model = null;

  async run(db: Database, benchCase: BenchmarkCase): Promise<StackProposal> {
    // Pass the fixture's needs verbatim — the zero-LLM decomposition path.
    const result = await handlePlan(db, {
      needs: benchCase.needs.map((n) => ({
        need: n.need,
        ...(n.category ? { category: n.category } : {}),
      })),
    });

    // handlePlan may return a { note } error if no slots were produced.
    if (!('slots' in result)) {
      return {
        selections: [],
        unmatchedNeedIds: benchCase.needs.filter((n) => n.required).map((n) => n.id),
      };
    }

    const plan = result as PlanOutput;
    const selections: ProposedSelection[] = [];
    const unmatchedNeedIds: string[] = [];

    for (const slot of plan.slots) {
      // Map slot back to fixture need by exact text match.
      const matched = benchCase.needs.find((n) => n.need === slot.need);

      // Pinned packages (from `using`) won't match fixture needs —
      // their need text is "using <name>", which is fine: they don't
      // contribute to coverage (no needId), but they are part of the
      // co-install stack. We still record them as selections.
      if (!matched) {
        // This is a pinned slot or an unexpected mutation.
        if (slot.recommended) {
          selections.push(
            toSelection(slot.recommended.name, slot, 'pinned'),
          );
        }
        continue;
      }

      if (slot.recommended) {
        selections.push(toSelection(matched.id, slot, 'lurq-plan'));
      } else {
        if (matched.required) {
          unmatchedNeedIds.push(matched.id);
        }
      }
    }

    // Also report fixture needs that had no slot at all (e.g. they were
    // deduplicated or capped by MAX_SLOTS).
    const coveredNeeds = new Set([
      ...selections.map((s) => s.needId),
      ...unmatchedNeedIds,
    ]);
    for (const need of benchCase.needs) {
      if (need.required && !coveredNeeds.has(need.id)) {
        unmatchedNeedIds.push(need.id);
      }
    }

    return { selections, unmatchedNeedIds };
  }
}

function toSelection(
  needId: string,
  slot: PlanOutput['slots'][number],
  source: string,
): ProposedSelection {
  const rec = slot.recommended!;
  return {
    needId,
    package: rec.name,
    requestedVersion: rec.latestVersion ?? null,
    scopeHint: 'unknown',
    category: slot.category ?? rec.category ?? null,
    lurqHealthScore: rec.healthScore,
    lurqConfidence: rec.confidence ?? null,
    lurqSwappedFrom: slot.swappedFrom ?? null,
    source,
  };
}
