import { describe, it, expect } from 'vitest';
import { computeMetrics } from '../../src/benchmark/results';
import type { BenchmarkResult } from '../../src/benchmark/types';

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

describe('benchmark results', () => {
  it('computes metrics for an empty array', () => {
    const metrics = computeMetrics([]);
    expect(metrics.coinstallableSlotFilledRate).toBe(0);
    expect(metrics.unknownRate).toBe(0);
    expect(metrics.resolutionSuccessRate).toBe(0);
  });

  it('computes valid stack rate and blocks on nonexistent or deprecated or archived', () => {
    const validStack = baseResult();
    const missingCov = baseResult({
      coverage: { kind: 'slot-fill', required: 2, covered: 1, missing: [], threshold: 2 },
    });
    const hasNonexistent = baseResult({
      packageValidity: {
        existing: 1,
        nonexistent: ['fake'],
        deprecated: [],
        archived: [],
        highRisk: [],
        unresolvedVersions: [],
      },
    });
    const hasDeprecated = baseResult({
      packageValidity: {
        existing: 2,
        nonexistent: [],
        deprecated: ['old'],
        archived: [],
        highRisk: [],
        unresolvedVersions: [],
      },
    });
    const hasArchived = baseResult({
      packageValidity: {
        existing: 2,
        nonexistent: [],
        deprecated: [],
        archived: ['dead'],
        highRisk: [],
        unresolvedVersions: [],
      },
    });
    const notInstalled = baseResult({
      resolution: {
        template: 'x',
        attempted: true,
        installed: false,
        loaded: [],
        durationMs: 10,
        failureClass: 'unknown-resolution-failure',
        scriptsFree: true,
      },
    });

    const metrics = computeMetrics([
      validStack,
      missingCov,
      hasNonexistent,
      hasDeprecated,
      hasArchived,
      notInstalled,
    ]);

    expect(metrics.coinstallableSlotFilledRate).toBe(1 / 6);
  });

  it('scores failure-detection against fixture labels, not E2B install alone', () => {
    // Deprecated package that still installs: correct Lurq flag must be TP, not FP.
    const deprecatedButInstalls = baseResult({
      runId: '2026-07-21T00-00-00Z-failure-detection-v1',
      caseId: 'deprecated-request',
      expectedOutcome: 'fail',
      packageValidity: {
        existing: 2,
        nonexistent: [],
        deprecated: ['request'],
        archived: [],
        highRisk: [],
        unresolvedVersions: [],
      },
      resolution: {
        template: 'x',
        attempted: true,
        installed: true,
        loaded: [{ name: 'express', loaded: true }, { name: 'request', loaded: true }],
        durationMs: 10,
        failureClass: null,
        scriptsFree: true,
      },
    });

    // Clean control that installs: Lurq pass → TN
    const cleanPass = baseResult({
      runId: '2026-07-21T00-00-00Z-failure-detection-v1',
      caseId: 'clean-express-stack',
      expectedOutcome: 'pass',
    });

    // Expected fail but Lurq missed → FN
    const missedFail = baseResult({
      runId: '2026-07-21T00-00-00Z-failure-detection-v1',
      caseId: 'engine-miss',
      expectedOutcome: 'fail',
      packageValidity: {
        existing: 2,
        nonexistent: [],
        deprecated: [],
        archived: [],
        highRisk: [],
        unresolvedVersions: [],
      },
      compatPrediction: 'compatible',
      resolution: {
        template: 'x',
        attempted: true,
        installed: false,
        loaded: [],
        durationMs: 10,
        failureClass: 'engine-conflict',
        scriptsFree: true,
      },
    });

    const metrics = computeMetrics([deprecatedButInstalls, cleanPass, missedFail]);
    expect(metrics.measurementStatus).toBe('measured-against-fixture-labels');
    // TP=1 (deprecated), FN=1 (missed), TN=1 → recall 1/2, precision 1/1
    expect(metrics.failureDetectionRecall).toBe(0.5);
    expect(metrics.failureDetectionPrecision).toBe(1);
  });
});
