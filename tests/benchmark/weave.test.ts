import { describe, it, expect } from 'vitest';
import {
  computeMetrics,
  hasNoBlockingPackage,
  isCoinstallableSlotFilled,
  predictedFail,
  validateTemplate,
} from '../../src/benchmark/results';
import { resolveTemplateRef } from '../../src/sandbox/e2b';
import { finishWeave, logResult, tracedRun, weaveEnabled } from '../../src/benchmark/weave';
import {
  BudgetExceededError,
  assertBudget,
  budgetStopped,
  initBudget,
  recordUsage,
  totalSpent,
} from '../../src/benchmark/budget';
import type { BenchmarkResult, Participant } from '../../src/benchmark/types';

function baseResult(overrides: Partial<BenchmarkResult> = {}): BenchmarkResult {
  return {
    runId: 'run',
    participant: { id: 'x', kind: 'lurq', model: null },
    caseId: 'c1',
    trial: 1,
    expectedOutcome: null,
    proposal: null,
    normalization: null,
    resolvedSelections: null,
    packageValidity: {
      existing: 2,
      nonexistent: [],
      deprecated: [],
      archived: [],
      highRisk: [],
      unresolvedVersions: [],
    },
    coverage: { kind: 'slot-fill', required: 1, covered: 1, missing: [], threshold: 1 },
    resolution: {
      template: 'x',
      attempted: true,
      installed: true,
      loaded: [],
      durationMs: 10,
      failureClass: null,
      scriptsFree: true,
    },
    compatPrediction: 'compatible',
    timestamps: { startedAt: '', finishedAt: '' },
    participantError: null,
    lurqDiagnosis: null,
    rawProposalPath: null,
    ...overrides,
  };
}

describe('benchmark predicates', () => {
  // The whole point of extracting these is that summary.csv and the Weave
  // leaderboard cannot disagree. If someone edits one definition, this fails.
  it('agrees with the aggregate computeMetrics rolls up', () => {
    const results = [
      baseResult(),
      baseResult({ packageValidity: { ...baseResult().packageValidity, nonexistent: ['nope-xyz'] } }),
      baseResult({ coverage: { kind: 'slot-fill', required: 2, covered: 1, missing: ['b'], threshold: 2 } }),
      baseResult({ resolution: { ...baseResult().resolution!, installed: false } }),
    ];
    const perResult = results.filter(isCoinstallableSlotFilled).length / results.length;
    expect(computeMetrics(results).coinstallableSlotFilledRate).toBe(perResult);
    expect(perResult).toBe(0.25);
  });

  it('separates "blocking" from "lurq would warn"', () => {
    // A high-risk package is enough for lurq to raise a flag, but it still
    // installs — so it must not disqualify a co-installable stack.
    const risky = baseResult({
      packageValidity: { ...baseResult().packageValidity, highRisk: ['left-pad'] },
    });
    expect(hasNoBlockingPackage(risky)).toBe(true);
    expect(isCoinstallableSlotFilled(risky)).toBe(true);
    expect(predictedFail(risky)).toBe(true);

    expect(predictedFail(baseResult())).toBe(false);
    expect(predictedFail(baseResult({ compatPrediction: 'conflict' }))).toBe(true);
  });
});

describe('weave mirror', () => {
  // Guards rule #1: no WEAVE_PROJECT / WANDB_API_KEY means every entry point is
  // inert. A benchmark must run offline with no vendor account.
  it('is inert and never throws when unconfigured', async () => {
    delete process.env.WEAVE_PROJECT;
    expect(weaveEnabled()).toBe(false);
    expect(() => logResult(baseResult())).not.toThrow();
    await expect(finishWeave([baseResult()])).resolves.toBeUndefined();
  });

  it('passes the participant through untraced when unconfigured', async () => {
    const participant = {
      id: 'p',
      kind: 'lurq',
      model: null,
      run: async () => ({ selections: [], unmatchedNeedIds: ['n1'] }),
    } as unknown as Participant;
    const run = tracedRun(participant, null as never);
    await expect(run({ id: 'c1' } as never)).resolves.toEqual({
      selections: [],
      unmatchedNeedIds: ['n1'],
    });
  });
});

describe('e2b template refs', () => {
  // The guard wants `name:id` so a run records which build produced a number.
  // The SDK reads `a:b` as template `a` tag `b` and 404s, and takes a bare id.
  // Both facts are true at once, so the label has to be stripped at the call.
  it('validates the documented form but hands E2B the bare id', () => {
    expect(validateTemplate('base:rki5dems9wqfm4r03t7g')).toBe('base:rki5dems9wqfm4r03t7g');
    expect(resolveTemplateRef('base:rki5dems9wqfm4r03t7g')).toBe('rki5dems9wqfm4r03t7g');
    expect(resolveTemplateRef('rki5dems9wqfm4r03t7g')).toBe('rki5dems9wqfm4r03t7g');
    // A mutable alias still has to be refused before it ever reaches E2B.
    expect(() => validateTemplate('base')).toThrow(/build-id/);
  });
});

describe('spend cap', () => {
  // The cap has to hold before the call, not after: a call's cost is only
  // known once it returns, so checking `spent < limit` lets the next call
  // overshoot by its own size. These assert the reserve actually reserves.
  it('refuses the call that would breach the cap, and never the one before', () => {
    initBudget(5);
    expect(() => assertBudget()).not.toThrow();

    // $4.40 spent: one more turn could cost up to the $0.50 reserve, and
    // $4.90 still fits under $5. Allowed.
    recordUsage('arm', 'claude-opus-5', { input_tokens: 200_000, output_tokens: 136_000 });
    expect(totalSpent()).toBeCloseTo(4.4, 2);
    expect(() => assertBudget()).not.toThrow();

    // $4.65 spent: another full turn could reach $5.15. Refused.
    recordUsage('arm', 'claude-opus-5', { input_tokens: 50_000, output_tokens: 0 });
    expect(totalSpent()).toBeCloseTo(4.65, 2);
    expect(() => assertBudget()).toThrow(BudgetExceededError);
    expect(budgetStopped()).toBe(true);
  });

  it('prices an unknown model at the most expensive rate, never at zero', () => {
    initBudget(5);
    recordUsage('arm', 'some-model-shipped-after-this-table', { input_tokens: 1_000_000, output_tokens: 0 });
    expect(totalSpent()).toBe(10);
  });

  it('is unlimited when no cap is set', () => {
    initBudget(null);
    recordUsage('arm', 'claude-opus-5', { input_tokens: 100_000_000, output_tokens: 0 });
    expect(() => assertBudget()).not.toThrow();
  });
});
