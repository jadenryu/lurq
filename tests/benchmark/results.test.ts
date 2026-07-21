import { describe, it, expect } from 'vitest';
import { computeMetrics } from '../../src/benchmark/results';
import type { BenchmarkResult } from '../../src/benchmark/types';

describe('benchmark results', () => {
  it('computes metrics for an empty array', () => {
    const metrics = computeMetrics([]);
    expect(metrics.coinstallableSlotFilledRate).toBe(0);
    expect(metrics.unknownRate).toBe(0);
    expect(metrics.resolutionSuccessRate).toBe(0);
  });

  it('computes valid stack rate and blocks on nonexistent or deprecated or archived', () => {
    const resultTemplate: BenchmarkResult = {
      runId: 'run',
      participant: { id: 'x', kind: 'lurq', model: null },
      caseId: 'c1',
      trial: 1,
      proposal: null,
      normalization: null,
      resolvedSelections: null,
      packageValidity: { existing: 2, nonexistent: [], deprecated: [], archived: [], highRisk: [], unresolvedVersions: [] },
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
    };

    const validStack = { ...resultTemplate };
    const missingCov = {
      ...resultTemplate,
      coverage: { kind: 'slot-fill' as const, required: 2, covered: 1, missing: [], threshold: 2 },
    };
    const hasNonexistent = {
      ...resultTemplate,
      packageValidity: { ...resultTemplate.packageValidity, nonexistent: ['fake'] },
    };
    const hasDeprecated = {
      ...resultTemplate,
      packageValidity: { ...resultTemplate.packageValidity, deprecated: ['old'] },
    };
    const hasArchived = {
      ...resultTemplate,
      packageValidity: { ...resultTemplate.packageValidity, archived: ['dead'] },
    };
    const notInstalled = {
      ...resultTemplate,
      resolution: { ...resultTemplate.resolution!, installed: false },
    };

    // Only validStack is a valid stack
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
});
