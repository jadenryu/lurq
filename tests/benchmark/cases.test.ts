import { describe, it, expect } from 'vitest';
import { loadCases, SuiteValidationError } from '../../src/benchmark/loadCases';

describe('loadCases', () => {
  it('loads the frozen 12-case stack-selection-v1 suite', () => {
    const suite = loadCases('stack-selection-v1');
    expect(suite.suite).toBe('stack-selection-v1');
    expect(suite.schemaVersion).toBe(1);
    expect(suite.cases).toHaveLength(12);
    expect(suite.runtime.node).toBe('20');
    expect(suite.runtime.packageManager).toBe('npm');

    // Every case has a non-empty id, document, and at least one required need.
    for (const c of suite.cases) {
      expect(c.id).toBeTruthy();
      expect(c.document).toBeTruthy();
      expect(c.needs.length).toBeGreaterThan(0);
      expect(c.needs.some((n) => n.required)).toBe(true);
    }
  });

  it('loads the adversarial 25-case stack-selection-v2 suite', () => {
    const suite = loadCases('stack-selection-v2');
    expect(suite.suite).toBe('stack-selection-v2');
    expect(suite.schemaVersion).toBe(1);
    expect(suite.cases).toHaveLength(25);
    expect(suite.runtime.node).toBe('20');
    expect(suite.runtime.packageManager).toBe('npm');

    const ids = new Set(suite.cases.map((c) => c.id));
    expect(ids.has('typescript-latest-eslint')).toBe(true);
    expect(ids.has('react19-spa-node20-ci')).toBe(true);
    expect(ids.has('brownfield-replace-request')).toBe(true);
    expect(ids.has('enzyme-to-rtl')).toBe(true);
    expect(ids.has('cra-to-vite-scaffold')).toBe(true);
    expect(ids.has('state-management-react19')).toBe(true);
    expect(ids.has('react19-spring-router-node20')).toBe(true);
    expect(ids.has('newest-router-on-node20')).toBe(true);
    expect(ids.has('brownfield-request-enzyme')).toBe(true);
    expect(ids.has('vite-react19-minimal')).toBe(true);
    expect(ids.has('node20-api-security')).toBe(true);

    for (const c of suite.cases) {
      expect(c.id).toBeTruthy();
      expect(c.document).toBeTruthy();
      expect(c.needs.some((n) => n.required)).toBe(true);
      expect(c.acceptance.constraints.length).toBeGreaterThan(0);
    }
  });

  it('loads the 10-case failure-detection-v1 suite', () => {
    const suite = loadCases('failure-detection-v1');
    expect(suite.suite).toBe('failure-detection-v1');
    expect(suite.schemaVersion).toBe(2);
    expect(suite.cases).toHaveLength(0);
    expect(suite.failureCases).toHaveLength(10);
    expect(suite.runtime.node).toBe('20');

    const ids = new Set(suite.failureCases!.map((c) => c.id));
    expect(ids.has('peer-conflict-react19-spring')).toBe(true);
    expect(ids.has('engine-conflict-angular22-on-node20')).toBe(true);
    expect(ids.has('clean-next-stack')).toBe(true);
    expect(ids.has('peer-conflict-react-17-18')).toBe(false);
    expect(ids.has('engine-mismatch-node22')).toBe(false);

    for (const c of suite.failureCases!) {
      expect(c.stack.length).toBeGreaterThan(0);
      expect(['pass', 'fail']).toContain(c.expectedResult);
    }
  });

  it('rejects duplicate case IDs', () => {
    expect(() =>
      validateRaw({
        suite: 'test',
        schemaVersion: 1,
        runtime: { node: '20', packageManager: 'npm', sandboxTemplate: 'test' },
        cases: [
          makeCase({ id: 'dup' }),
          makeCase({ id: 'dup' }),
        ],
      }),
    ).toThrow(SuiteValidationError);
    expect(() =>
      validateRaw({
        suite: 'test',
        schemaVersion: 1,
        runtime: { node: '20', packageManager: 'npm', sandboxTemplate: 'test' },
        cases: [
          makeCase({ id: 'dup' }),
          makeCase({ id: 'dup' }),
        ],
      }),
    ).toThrow(/[Dd]uplicate case id/);
  });

  it('rejects unknown category', () => {
    expect(() =>
      validateRaw({
        suite: 'test',
        schemaVersion: 1,
        runtime: { node: '20', packageManager: 'npm', sandboxTemplate: 'test' },
        cases: [
          makeCase({
            needs: [
              { id: 'x', need: 'something', category: 'not-a-real-category', required: true },
            ],
          }),
        ],
      }),
    ).toThrow(SuiteValidationError);
    expect(() =>
      validateRaw({
        suite: 'test',
        schemaVersion: 1,
        runtime: { node: '20', packageManager: 'npm', sandboxTemplate: 'test' },
        cases: [
          makeCase({
            needs: [
              { id: 'x', need: 'something', category: 'not-a-real-category', required: true },
            ],
          }),
        ],
      }),
    ).toThrow(/category is unknown/i);
  });

  it('rejects cases with zero required needs', () => {
    expect(() =>
      validateRaw({
        suite: 'test',
        schemaVersion: 1,
        runtime: { node: '20', packageManager: 'npm', sandboxTemplate: 'test' },
        cases: [
          makeCase({
            needs: [{ id: 'x', need: 'optional thing', required: false }],
          }),
        ],
      }),
    ).toThrow(SuiteValidationError);
  });

  it('rejects cases where two needs share identical need text', () => {
    expect(() =>
      validateRaw({
        suite: 'test',
        schemaVersion: 1,
        runtime: { node: '20', packageManager: 'npm', sandboxTemplate: 'test' },
        cases: [
          makeCase({
            needs: [
              { id: 'a', need: 'same text', required: true },
              { id: 'b', need: 'same text', required: true },
            ],
          }),
        ],
      }),
    ).toThrow(/duplicate need text/i);
  });

  it('rejects cases missing id', () => {
    expect(() =>
      validateRaw({
        suite: 'test',
        schemaVersion: 1,
        runtime: { node: '20', packageManager: 'npm', sandboxTemplate: 'test' },
        cases: [makeCase({ id: '' })],
      }),
    ).toThrow(SuiteValidationError);
  });

  it('rejects cases missing document', () => {
    expect(() =>
      validateRaw({
        suite: 'test',
        schemaVersion: 1,
        runtime: { node: '20', packageManager: 'npm', sandboxTemplate: 'test' },
        cases: [makeCase({ document: '' })],
      }),
    ).toThrow(SuiteValidationError);
  });

  it('rejects invalid Node version', () => {
    expect(() =>
      validateRaw({
        suite: 'test',
        schemaVersion: 1,
        runtime: { node: 'v20.1.0', packageManager: 'npm', sandboxTemplate: 'test' },
        cases: [makeCase()],
      }),
    ).toThrow(/major-version/i);
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Simulate loadCases without filesystem I/O — validates in-memory JSON.
 * We import the internal validation by re-parsing through the module's
 * public surface: write temp file → loadCases.
 */
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function validateRaw(raw: unknown): void {
  // Write the raw JSON to a temp file so loadCases can read it.
  const dir = mkdtempSync(join(tmpdir(), 'lurq-bench-test-'));
  const suiteName = 'test-suite';
  // loadCases resolves relative to cwd, so write to tests/benchmark/.
  const filePath = join(process.cwd(), 'tests', 'benchmark', `${suiteName}.json`);
  try {
    writeFileSync(filePath, JSON.stringify(raw));
    loadCases(suiteName);
  } finally {
    try { rmSync(filePath); } catch { /* ok */ }
    try { rmSync(dir, { recursive: true }); } catch { /* ok */ }
  }
}

function makeCase(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'test-case',
    title: 'Test Case',
    document: 'Build something.',
    topology: 'single-app',
    needs: [
      { id: 'web', need: 'React framework', category: 'framework', required: true },
    ],
    acceptance: { minimumCovered: 1, constraints: [] },
    ...overrides,
  };
}
