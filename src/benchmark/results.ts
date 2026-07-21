/**
 * Benchmark result writers — manifest, per-trial rows, summary, raw output.
 *
 * All writes are append-safe: writeLine appends to results.jsonl one line at
 * a time, so a crash mid-run never loses prior trials.
 *
 * writeRaw strips keys matching /key|token|secret|authorization|credential/i
 * before writing — no secrets ever enter artifact files.
 */
import { execSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { packages } from '../db/schema';
import { compatEdges } from '../db/schema';
import type { Config } from '../core/config';
import type { Sandbox } from '../sandbox/types';
import type {
  BenchmarkManifest,
  BenchmarkMetrics,
  BenchmarkResult,
  BenchmarkSuite,
} from './types';

// ── E2B_TEMPLATE format guard ───────────────────────────────────────────────

/** Validates that E2B_TEMPLATE is in immutable "template-name:build-id" form. */
const TEMPLATE_RE = /^[a-z][a-z0-9_-]*:[a-f0-9-]{8,}$/i;

export function validateTemplate(template: string | undefined): string {
  if (!template) {
    throw new Error('E2B_TEMPLATE is required for benchmark runs.');
  }
  if (!TEMPLATE_RE.test(template)) {
    throw new Error(
      `E2B_TEMPLATE must be in "template-name:build-id" form, got "${template}". ` +
        `Mutable tags (e.g. "base") are not allowed for benchmark runs.`,
    );
  }
  return template;
}

// ── Run ID ──────────────────────────────────────────────────────────────────

export function makeRunId(suite: string): string {
  const now = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace(/Z$/, 'Z');
  return `${now}-${suite}`;
}

// ── Manifest ────────────────────────────────────────────────────────────────

export async function collectManifest(
  db: Database,
  suite: BenchmarkSuite,
  config: Config,
  sandbox: Sandbox | null,
): Promise<BenchmarkManifest> {
  // Git SHA
  let gitSha = 'unknown';
  try {
    gitSha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch { /* not in a git repo */ }

  // Package stats from DB
  const [[stats], [compatStats]] = await Promise.all([
    db
      .select({
        count: sql<number>`count(*)::int`,
        oldest: sql<string | null>`min(${packages.dataAsOf})`,
        newest: sql<string | null>`max(${packages.dataAsOf})`,
        missingCategory: sql<number>`count(*) filter (where ${packages.category} is null)::int`,
        missingVersion: sql<number>`count(*) filter (where ${packages.latestVersion} is null)::int`,
        missingEmbedding: sql<number>`count(*) filter (where ${packages.embedding} is null)::int`,
      })
      .from(packages),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(compatEdges)
  ]);
  // Selecting real columns (rather than only count(*)) detects unapplied
  // compat_edges migrations before a benchmark silently loses this evidence.
  await db.select().from(compatEdges).limit(1);

  // E2B node/npm versions — only available with a live sandbox
  let nodeVersionInE2B = 'unknown';
  let npmVersionInE2B = 'unknown';
  if (!sandbox) {
    throw new Error('A live E2B sandbox is required to collect an official benchmark manifest.');
  }
  const info = await sandbox.getRuntimeInfo();
  nodeVersionInE2B = info.nodeVersion;
  npmVersionInE2B = info.npmVersion;
  if (nodeVersionInE2B === 'unknown' || npmVersionInE2B === 'unknown') {
    throw new Error('Could not record Node and npm versions from the E2B template.');
  }

  const template = validateTemplate(config.E2B_TEMPLATE);

  return {
    gitSha,
    suite: suite.suite,
    suiteSchemaVersion: suite.schemaVersion,
    packageCount: stats?.count ?? 0,
    oldestDataAsOf: stats?.oldest ? new Date(stats.oldest).toISOString() : 'unknown',
    newestDataAsOf: stats?.newest ? new Date(stats.newest).toISOString() : 'unknown',
    missingCategoryCount: stats?.missingCategory ?? 0,
    missingLatestVersionCount: stats?.missingVersion ?? 0,
    missingEmbeddingCount: stats?.missingEmbedding ?? 0,
    compatEdgeCount: compatStats?.count ?? 0,
    e2bTemplate: template,
    nodeVersionInE2B,
    npmVersionInE2B,
    scriptsFree: true,
  };
}

/** Lighter manifest for dry-run mode (no DB or E2B). */
export function dryRunManifest(suite: BenchmarkSuite): BenchmarkManifest {
  let gitSha = 'unknown';
  try {
    gitSha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch { /* ok */ }

  return {
    gitSha,
    suite: suite.suite,
    suiteSchemaVersion: suite.schemaVersion,
    packageCount: 0,
    oldestDataAsOf: 'dry-run',
    newestDataAsOf: 'dry-run',
    missingCategoryCount: 0,
    missingLatestVersionCount: 0,
    missingEmbeddingCount: 0,
    compatEdgeCount: 0,
    e2bTemplate: 'dry-run',
    nodeVersionInE2B: 'dry-run',
    npmVersionInE2B: 'dry-run',
    scriptsFree: true,
  };
}

// ── Writers ─────────────────────────────────────────────────────────────────

/** Ensure the output directory tree exists. */
export function ensureRunDir(runId: string): string {
  const dir = join('artifacts', 'benchmarks', runId);
  mkdirSync(join(dir, 'raw'), { recursive: true });
  return dir;
}

/** Write manifest.json. */
export function writeManifest(dir: string, manifest: BenchmarkManifest): void {
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}

/** Append one BenchmarkResult as a JSON line. */
export function writeLine(dir: string, result: BenchmarkResult): void {
  appendFileSync(join(dir, 'results.jsonl'), JSON.stringify(result) + '\n');
}

/** Write sanitized raw participant output. */
export function writeRaw(dir: string, caseId: string, trial: number, raw: unknown): void {
  const sanitized = sanitize(raw);
  writeFileSync(
    join(dir, 'raw', `${caseId}-trial-${trial}.json`),
    JSON.stringify(sanitized, null, 2) + '\n',
  );
}

// ── Summary ─────────────────────────────────────────────────────────────────

export function writeSummary(dir: string, results: BenchmarkResult[]): void {
  // Group results by participant ID
  const groupedResults = new Map<string, BenchmarkResult[]>();
  for (const r of results) {
    const id = r.participant.id;
    if (!groupedResults.has(id)) groupedResults.set(id, []);
    groupedResults.get(id)!.push(r);
  }

  // Compute metrics for each participant
  const summaryJson: Record<string, BenchmarkMetrics> = {};
  for (const [id, idResults] of groupedResults.entries()) {
    summaryJson[id] = computeMetrics(idResults);
  }

  writeFileSync(join(dir, 'summary.json'), JSON.stringify(summaryJson, null, 2) + '\n');

  // CSV summary
  if (groupedResults.size > 0) {
    const firstMetrics = Object.values(summaryJson)[0]!;
    const headers = ['participantId', ...Object.keys(firstMetrics)];
    
    let csvContent = headers.join(',') + '\n';
    for (const [id, metrics] of Object.entries(summaryJson)) {
      const values = [id, ...Object.values(metrics).map((v) => (v === null ? '' : String(v)))];
      csvContent += values.join(',') + '\n';
    }
    
    writeFileSync(join(dir, 'summary.csv'), csvContent);
  }
}

export function computeMetrics(results: BenchmarkResult[]): BenchmarkMetrics {
  if (results.length === 0) {
    return {
      packageExistenceRate: 0,
      packageRiskRate: 0,
      requirementSlotFillRate: 0,
      resolutionSuccessRate: 0,
      runtimeLoadSuccessRate: 0,
      coinstallableSlotFilledRate: 0,
      unknownRate: 0,
      semanticValidStackRate: null,
      failureDetectionRecall: null,
      failureDetectionPrecision: null,
      measurementStatus: 'not-measured-in-stack-selection-v1',
    };
  }

  // Package existence rate: existing / (existing + nonexistent) across all trials
  let totalExisting = 0;
  let totalPackages = 0;
  const riskyPackages = new Set<string>();
  for (const r of results) {
    totalExisting += r.packageValidity.existing;
    totalPackages +=
      r.packageValidity.existing + r.packageValidity.nonexistent.length;
    for (const name of [
      ...r.packageValidity.deprecated,
      ...r.packageValidity.archived,
      ...r.packageValidity.highRisk,
    ]) {
      riskyPackages.add(`${r.runId}:${r.caseId}:${r.trial}:${name}`);
    }
  }

  // Coverage
  let totalRequired = 0;
  let totalCovered = 0;
  for (const r of results) {
    totalRequired += r.coverage.required;
    totalCovered += r.coverage.covered;
  }

  // Resolution + load
  let resolutionAttempts = 0;
  let resolutionSuccesses = 0;
  let loadAttempts = 0;
  let loadSuccesses = 0;
  let coinstallableSlotFilled = 0;
  let unknowns = 0;

  for (const r of results) {
    if (r.resolution?.attempted) {
      resolutionAttempts++;
      if (r.resolution.installed) {
        resolutionSuccesses++;
        // Runtime load
        const runtimeLoads = r.resolution.loaded;
        for (const l of runtimeLoads) {
          loadAttempts++;
          if (l.loaded === true) loadSuccesses++;
        }
      }
    }

    // This is deliberately mechanical: it proves filled slots plus safety and
    // E2B behavior. It does not claim that a package semantically fulfils a
    // requirement; that needs independent review.
    const coverageMet =
      r.coverage.required > 0 && r.coverage.covered >= r.coverage.threshold;
    const noBlocking =
      r.packageValidity.nonexistent.length === 0 &&
      r.packageValidity.deprecated.length === 0 &&
      r.packageValidity.archived.length === 0 &&
      r.packageValidity.unresolvedVersions.length === 0 &&
      (r.normalization?.invalidNames.length ?? 0) === 0;
    const resolved = r.resolution?.attempted === true && r.resolution.installed === true;
    const allRuntimeLoaded = r.resolution?.loaded.every((load) => load.loaded === true) ?? false;
    if (coverageMet && noBlocking && resolved && allRuntimeLoaded) coinstallableSlotFilled++;

    // Unknown rate
    if (r.compatPrediction === 'unknown') unknowns++;
  }

  const div = (num: number, den: number): number => (den === 0 ? 0 : num / den);

  const isFailureSuite = results.length > 0 && results[0]?.runId.includes('failure-detection-v1');
  let failureDetectionRecall: number | null = null;
  let failureDetectionPrecision: number | null = null;
  let measurementStatus = isFailureSuite ? 'measured' : 'not-measured-in-stack-selection-v1';

  if (isFailureSuite) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let tn = 0;

    for (const r of results) {
      // Lurq predicts failure if:
      // 1. Any package is nonexistent, deprecated, archived, high risk, or has unresolved versions.
      // 2. OR normalization failed (invalid names).
      // 3. OR compat check returned 'conflict'.
      const hasPreflightWarning = 
        r.packageValidity.nonexistent.length > 0 ||
        r.packageValidity.deprecated.length > 0 ||
        r.packageValidity.archived.length > 0 ||
        r.packageValidity.highRisk.length > 0 ||
        r.packageValidity.unresolvedVersions.length > 0 ||
        (r.normalization?.invalidNames.length ?? 0) > 0;
      
      const lurqPredictedFail = hasPreflightWarning || r.compatPrediction === 'conflict';
      
      // Actual E2B failure
      const actualFail = 
        !r.resolution?.installed || 
        r.resolution.loaded.some(l => l.loaded === false);

      if (lurqPredictedFail && actualFail) tp++;
      else if (lurqPredictedFail && !actualFail) fp++;
      else if (!lurqPredictedFail && actualFail) fn++;
      else if (!lurqPredictedFail && !actualFail) tn++;
    }

    failureDetectionRecall = tp + fn > 0 ? tp / (tp + fn) : 0;
    failureDetectionPrecision = tp + fp > 0 ? tp / (tp + fp) : 0;
  }

  return {
    packageExistenceRate: div(totalExisting, totalPackages),
    packageRiskRate: div(riskyPackages.size, totalPackages),
    requirementSlotFillRate: div(totalCovered, totalRequired),
    resolutionSuccessRate: div(resolutionSuccesses, resolutionAttempts),
    runtimeLoadSuccessRate: div(loadSuccesses, loadAttempts),
    coinstallableSlotFilledRate: div(coinstallableSlotFilled, results.length),
    unknownRate: div(unknowns, results.length),
    semanticValidStackRate: null,
    failureDetectionRecall,
    failureDetectionPrecision,
    measurementStatus,
  };
}

// ── Sanitization ────────────────────────────────────────────────────────────

const SECRET_RE = /key|token|secret|authorization|credential/i;

function sanitize(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return obj;
  if (typeof obj === 'number' || typeof obj === 'boolean') return obj;
  if (Array.isArray(obj)) return obj.map(sanitize);
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (SECRET_RE.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = sanitize(v);
      }
    }
    return out;
  }
  return obj;
}
