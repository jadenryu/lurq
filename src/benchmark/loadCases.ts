/**
 * Load and validate a benchmark suite JSON file.
 *
 * Validation rules:
 *   - No duplicate case IDs.
 *   - Every case must have at least one need with `required: true`.
 *   - Categories, when present, must be in CATEGORIES.
 *   - Node version must be a valid major-version string.
 *   - No two needs within the same case may share identical `need` text
 *     (ensures structural need-mapping is unambiguous).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isCategory, type Category } from '../core/types';
import type { BenchmarkSuite, BenchmarkCase, BenchmarkNeed, FailureDetectionCase } from './types';

export class SuiteValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SuiteValidationError';
  }
}

/** Load and validate a suite file. `suiteName` is the stem (no `.json`). */
export function loadCases(suiteName: string): BenchmarkSuite {
  const filePath = resolve('tests/benchmark', `${suiteName}.json`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new SuiteValidationError(
      `Failed to read suite "${suiteName}": ${(err as Error).message}`,
    );
  }
  return validateSuite(raw);
}

function validateSuite(raw: unknown): BenchmarkSuite {
  if (!raw || typeof raw !== 'object') {
    throw new SuiteValidationError('Suite file must contain a JSON object.');
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.suite !== 'string' || !obj.suite) {
    throw new SuiteValidationError('Suite must have a non-empty "suite" name.');
  }
  if (typeof obj.schemaVersion !== 'number') {
    throw new SuiteValidationError('Suite must have a numeric "schemaVersion".');
  }

  // ── Runtime ───────────────────────────────────────────────────────────────
  const rt = obj.runtime as Record<string, unknown> | undefined;
  if (!rt || typeof rt !== 'object') {
    throw new SuiteValidationError('Suite must have a "runtime" object.');
  }
  if (typeof rt.node !== 'string' || !/^\d+$/.test(rt.node)) {
    throw new SuiteValidationError(
      `runtime.node must be a valid major-version string (e.g. "20"), got "${String(rt.node)}".`,
    );
  }
  if (typeof rt.packageManager !== 'string' || !rt.packageManager) {
    throw new SuiteValidationError('runtime.packageManager must be a non-empty string.');
  }
  if (typeof rt.sandboxTemplate !== 'string' || !rt.sandboxTemplate) {
    throw new SuiteValidationError('runtime.sandboxTemplate must be a non-empty string.');
  }
  const runtime = {
    node: rt.node as string,
    packageManager: rt.packageManager as string,
    sandboxTemplate: rt.sandboxTemplate as string,
  };

  // ── Schema specifics ──────────────────────────────────────────────────────
  if (obj.schemaVersion === 2) {
    if (!Array.isArray(obj.cases)) {
      throw new SuiteValidationError('Schema v2 suite must have a "cases" array.');
    }
    const failureCases: FailureDetectionCase[] = [];
    for (let i = 0; i < obj.cases.length; i++) {
      const c = obj.cases[i] as Record<string, unknown>;
      if (typeof c.id !== 'string' || !c.id) {
        throw new SuiteValidationError(`Schema v2 case at index ${i} must have a non-empty "id".`);
      }
      if (c.expectedResult !== 'pass' && c.expectedResult !== 'fail') {
        throw new SuiteValidationError(`Schema v2 case "${c.id}" expectedResult must be "pass" or "fail".`);
      }
      if (!Array.isArray(c.stack)) {
        throw new SuiteValidationError(`Schema v2 case "${c.id}" must have a "stack" array.`);
      }
      failureCases.push({
        id: c.id,
        expectedResult: c.expectedResult as 'pass' | 'fail',
        stack: c.stack as string[],
      });
    }
    return {
      suite: obj.suite as string,
      schemaVersion: 2,
      runtime,
      cases: [],
      failureCases,
    };
  }

  // ── Schema v1 ─────────────────────────────────────────────────────────────
  if (!Array.isArray(obj.cases) || obj.cases.length === 0) {
    throw new SuiteValidationError('Suite must have a non-empty "cases" array.');
  }

  const cases: BenchmarkCase[] = [];
  const seenCaseIds = new Set<string>();

  for (let i = 0; i < obj.cases.length; i++) {
    const c = obj.cases[i] as Record<string, unknown>;

    if (typeof c.id !== 'string' || !c.id) {
      throw new SuiteValidationError(`Case at index ${i} must have a non-empty "id".`);
    }
    if (seenCaseIds.has(c.id)) {
      throw new SuiteValidationError(`Duplicate case id: "${c.id}".`);
    }
    seenCaseIds.add(c.id);

    if (typeof c.title !== 'string') {
      throw new SuiteValidationError(`Case "${c.id}" must have a string "title".`);
    }
    if (typeof c.document !== 'string' || !c.document.trim()) {
      throw new SuiteValidationError(`Case "${c.id}" must have a non-empty string "document".`);
    }
    if (typeof c.topology !== 'string') {
      throw new SuiteValidationError(`Case "${c.id}" must have a string "topology".`);
    }

    // ── Needs ───────────────────────────────────────────────────────────────
    if (!Array.isArray(c.needs) || c.needs.length === 0) {
      throw new SuiteValidationError(`Case "${c.id}" must have at least one need.`);
    }

    const needs: BenchmarkNeed[] = [];
    const seenNeedTexts = new Set<string>();
    const seenNeedIds = new Set<string>();
    let hasRequiredNeed = false;

    for (let j = 0; j < c.needs.length; j++) {
      const n = c.needs[j] as Record<string, unknown>;
      if (typeof n.id !== 'string' || !n.id) {
        throw new SuiteValidationError(`Case "${c.id}" need at index ${j} must have an "id".`);
      }
      if (seenNeedIds.has(n.id)) {
        throw new SuiteValidationError(`Case "${c.id}" has duplicate need id: "${n.id}".`);
      }
      seenNeedIds.add(n.id);

      if (typeof n.need !== 'string' || !n.need.trim()) {
        throw new SuiteValidationError(
          `Case "${c.id}" need "${n.id}" must have non-empty "need" text.`,
        );
      }
      if (seenNeedTexts.has(n.need)) {
        throw new SuiteValidationError(
          `Case "${c.id}" has duplicate need text: "${n.need}". Structural maps require unique need texts.`,
        );
      }
      seenNeedTexts.add(n.need);

      if (n.category !== undefined && typeof n.category !== 'string') {
        throw new SuiteValidationError(`Case "${c.id}" need "${n.id}" category must be a string.`);
      }
      if (n.category && !isCategory(n.category)) {
        throw new SuiteValidationError(`Case "${c.id}" need "${n.id}" category is unknown.`);
      }

      if (typeof n.required !== 'boolean') {
        throw new SuiteValidationError(
          `Case "${c.id}" need "${n.id}" must specify "required" boolean.`,
        );
      }
      if (n.required) hasRequiredNeed = true;

      needs.push({
        id: n.id,
        need: n.need,
        category: n.category as Category | undefined,
        required: n.required,
      });
    }

    if (!hasRequiredNeed) {
      throw new SuiteValidationError(
        `Case "${c.id}" must have at least one need with \`required: true\`.`,
      );
    }

    // ── Acceptance ──────────────────────────────────────────────────────────
    const acc = c.acceptance as Record<string, unknown> | undefined;
    if (!acc || typeof acc !== 'object') {
      throw new SuiteValidationError(`Case "${c.id}" must have an "acceptance" block.`);
    }
    if (typeof acc.minimumCovered !== 'number') {
      throw new SuiteValidationError(
        `Case "${c.id}" acceptance must have a numeric "minimumCovered".`,
      );
    }
    if (!Array.isArray(acc.constraints)) {
      throw new SuiteValidationError(
        `Case "${c.id}" acceptance must have a "constraints" array of strings.`,
      );
    }

    cases.push({
      id: c.id,
      title: c.title,
      document: c.document,
      topology: c.topology,
      needs,
      acceptance: {
        minimumCovered: acc.minimumCovered as number,
        constraints: acc.constraints as string[],
      },
    });
  }

  return {
    suite: obj.suite as string,
    schemaVersion: obj.schemaVersion as number,
    runtime,
    cases,
  };
}
