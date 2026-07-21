import { describe, it, expect } from 'vitest';
import { isValidNpmName, normalizeProposal, evaluateCoverage } from '../../src/benchmark/normalize';
import type { ProposedSelection, StackProposal, BenchmarkCase } from '../../src/benchmark/types';

// ── helpers ─────────────────────────────────────────────────────────────────

function sel(overrides: Partial<ProposedSelection> = {}): ProposedSelection {
  return {
    needId: 'web',
    package: 'next',
    requestedVersion: null,
    scopeHint: 'unknown',
    category: null,
    lurqHealthScore: null,
    lurqConfidence: null,
    lurqSwappedFrom: null,
    source: 'test',
    ...overrides,
  };
}

function proposal(selections: ProposedSelection[]): StackProposal {
  return { selections, unmatchedNeedIds: [] };
}

// ── isValidNpmName ──────────────────────────────────────────────────────────

describe('isValidNpmName', () => {
  it('accepts valid unscoped names', () => {
    expect(isValidNpmName('express')).toBe(true);
    expect(isValidNpmName('lodash')).toBe(true);
    expect(isValidNpmName('my-package')).toBe(true);
  });

  it('accepts valid scoped names', () => {
    expect(isValidNpmName('@types/node')).toBe(true);
    expect(isValidNpmName('@clerk/nextjs')).toBe(true);
  });

  it('rejects names with spaces', () => {
    expect(isValidNpmName('bad name')).toBe(false);
  });

  it('rejects names starting with a dash', () => {
    expect(isValidNpmName('-bad')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidNpmName('')).toBe(false);
  });

  it('rejects names with uppercase', () => {
    expect(isValidNpmName('MyPackage')).toBe(false);
  });
});

// ── normalizeProposal ───────────────────────────────────────────────────────

describe('normalizeProposal', () => {
  it('passes valid selections through unchanged', () => {
    const result = normalizeProposal(proposal([
      sel({ package: 'next', needId: 'web' }),
      sel({ package: 'zod', needId: 'validation' }),
    ]));
    expect(result.invalidNames).toEqual([]);
    expect(result.duplicateNames).toEqual([]);
    expect(result.runtimePackages).toHaveLength(2);
    expect(result.developmentPackages).toHaveLength(0);
  });

  it('records and removes duplicates', () => {
    const result = normalizeProposal(proposal([
      sel({ package: 'next', needId: 'web' }),
      sel({ package: 'next', needId: 'web-dup' }),
    ]));
    expect(result.duplicateNames).toEqual(['next']);
    expect(result.runtimePackages).toHaveLength(1);
  });

  it('records and excludes invalid names — space', () => {
    const result = normalizeProposal(proposal([
      sel({ package: 'bad name' }),
    ]));
    expect(result.invalidNames).toEqual(['bad name']);
    expect(result.runtimePackages).toHaveLength(0);
  });

  it('records and excludes invalid names — leading dash', () => {
    const result = normalizeProposal(proposal([
      sel({ package: '-bad' }),
    ]));
    expect(result.invalidNames).toEqual(['-bad']);
  });

  it('classifies @types/* as development', () => {
    const result = normalizeProposal(proposal([
      sel({ package: '@types/node', scopeHint: 'unknown' }),
    ]));
    expect(result.developmentPackages).toHaveLength(1);
    expect(result.runtimePackages).toHaveLength(0);
    expect(result.developmentPackages[0]!.isRuntime).toBe(false);
  });

  it('scopeHint "development" overrides category fallback', () => {
    const result = normalizeProposal(proposal([
      sel({ package: 'express', scopeHint: 'development', category: 'framework' }),
    ]));
    expect(result.developmentPackages).toHaveLength(1);
    expect(result.developmentPackages[0]!.isRuntime).toBe(false);
  });

  it('classifies build-tool category as development', () => {
    const result = normalizeProposal(proposal([
      sel({ package: 'webpack', category: 'build-tool', scopeHint: 'unknown' }),
    ]));
    expect(result.developmentPackages).toHaveLength(1);
  });

  it('classifies bundler category as development', () => {
    const result = normalizeProposal(proposal([
      sel({ package: 'esbuild', category: 'bundler', scopeHint: 'unknown' }),
    ]));
    expect(result.developmentPackages).toHaveLength(1);
  });

  it('classifies linting category as development', () => {
    const result = normalizeProposal(proposal([
      sel({ package: 'eslint', category: 'linting', scopeHint: 'unknown' }),
    ]));
    expect(result.developmentPackages).toHaveLength(1);
  });
});

// ── evaluateCoverage ────────────────────────────────────────────────────────

describe('evaluateCoverage', () => {
  const benchCase: BenchmarkCase = {
    id: 'test',
    title: 'Test',
    document: 'Build something.',
    topology: 'single-app',
    needs: [
      { id: 'web', need: 'React framework', required: true },
      { id: 'orm', need: 'PostgreSQL ORM', required: true },
      { id: 'styling', need: 'CSS styling', required: false },
    ],
    acceptance: { minimumCovered: 2, constraints: [] },
  };

  it('counts covered needs by needId match', () => {
    const result = evaluateCoverage(benchCase, proposal([
      sel({ needId: 'web', package: 'next' }),
      sel({ needId: 'orm', package: 'drizzle-orm' }),
    ]));
    expect(result.required).toBe(2);
    expect(result.covered).toBe(2);
    expect(result.missing).toEqual([]);
  });

  it('does not credit coverage for extra packages without needId match', () => {
    const result = evaluateCoverage(benchCase, proposal([
      sel({ needId: 'web', package: 'next' }),
      sel({ needId: 'random', package: 'lodash' }),
    ]));
    expect(result.covered).toBe(1);
    expect(result.missing).toEqual(['orm']);
  });

  it('reports missing required needs correctly', () => {
    const result = evaluateCoverage(benchCase, proposal([]));
    expect(result.required).toBe(2);
    expect(result.covered).toBe(0);
    expect(result.missing).toEqual(['web', 'orm']);
  });

  it('ignores optional needs for coverage count', () => {
    const result = evaluateCoverage(benchCase, proposal([
      sel({ needId: 'web', package: 'next' }),
      sel({ needId: 'orm', package: 'drizzle-orm' }),
      // styling is optional — not counted even if missing
    ]));
    expect(result.required).toBe(2);
    expect(result.covered).toBe(2);
  });

  it('two required needs, one matched → covered: 1, missing the unmatched', () => {
    const result = evaluateCoverage(benchCase, proposal([
      sel({ needId: 'web', package: 'next' }),
    ]));
    expect(result.covered).toBe(1);
    expect(result.missing).toEqual(['orm']);
  });
});
