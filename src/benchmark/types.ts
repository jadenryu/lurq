/**
 * Benchmark v1 contracts.
 *
 * Every type here maps to a structural role in the benchmark pipeline:
 *   Fixture → Participant → Proposal → Normalize → Resolve → Result → Summary
 *
 * Design constraints:
 *   - Coverage is requirement-level, not package-count (§ amendment #1).
 *   - Every selection carries full provenance (§ amendment #2).
 *   - `isRuntime` is set only by normalization (§ amendment #4).
 *   - `install-script-failure` is reserved; scripts are off in v1 (§ amendment #4).
 *   - Only 7 metrics are measurable in this pass (§ amendment #2).
 */
import type { Category } from '../core/types';
import type { Database } from '../db/client';

// ── Fixture types ───────────────────────────────────────────────────────────

export interface BenchmarkNeed {
  id: string;
  need: string;
  category?: Category;
  required: boolean;
}

export interface BenchmarkCase {
  id: string;
  title: string;
  document: string;
  topology: string;
  needs: BenchmarkNeed[];
  acceptance: { minimumCovered: number; constraints: string[] };
}

export interface FailureDetectionCase {
  id: string;
  expectedResult: 'pass' | 'fail';
  stack: string[];
}

export interface BenchmarkSuite {
  suite: string;
  schemaVersion: number;
  runtime: { node: string; packageManager: string; sandboxTemplate: string };
  cases: BenchmarkCase[];
  failureCases?: FailureDetectionCase[];
}

// ── Participant output ──────────────────────────────────────────────────────

/**
 * One resolved package with full provenance.
 *
 * `scopeHint` is participant-provided; `isRuntime` is set only by
 * normalization. `category` generalizes across all participant types;
 * Lurq fills it from the plan slot, model participants may leave it null.
 */
export interface ProposedSelection {
  needId: string;
  package: string;
  requestedVersion: string | null;
  scopeHint: 'runtime' | 'development' | 'unknown';
  category: string | null;
  // Lurq-specific provenance (null for model participants):
  lurqHealthScore: number | null;
  lurqConfidence: string | null;
  lurqSwappedFrom: string | null;
  source: string;
}

export interface NormalizedSelection extends ProposedSelection {
  isRuntime: boolean;
}

export interface ResolvedSelection extends NormalizedSelection {
  resolvedVersion: string | null;
}

/** What every participant returns — requirement-level selections. */
export interface StackProposal {
  selections: ProposedSelection[];
  unmatchedNeedIds: string[];
}

// ── Normalization ───────────────────────────────────────────────────────────

export interface NormalizedProposal {
  duplicateNames: string[];
  invalidNames: string[];
  runtimePackages: NormalizedSelection[];
  developmentPackages: NormalizedSelection[];
}

// ── Resolution ──────────────────────────────────────────────────────────────

export type FailureClass =
  | 'nonexistent-package'
  | 'invalid-package-name'
  | 'peer-dependency-conflict'
  | 'engine-conflict'
  | 'install-script-failure' // reserved; scripts are off in v1
  | 'native-build-failure'
  | 'runtime-load-failure'
  | 'version-resolution-failure'
  | 'timeout'
  | 'unknown-resolution-failure';

export interface ResolutionOutcome {
  template: string;
  /** True only when E2B was actually invoked. Preflight failures do not count
   * as sandbox-resolution attempts. */
  attempted: boolean;
  installed: boolean;
  loaded: { name: string; loaded: boolean | null }[];
  durationMs: number;
  failureClass: FailureClass | null;
  scriptsFree: true;
}

// ── Coverage ────────────────────────────────────────────────────────────────

export interface CoverageResult {
  /** This is a slot-fill measurement, not independent semantic adjudication. */
  kind: 'slot-fill';
  required: number;
  covered: number;
  threshold: number;
  missing: string[];
}

export interface PackageValidity {
  existing: number;
  nonexistent: string[];
  deprecated: string[];
  archived: string[];
  highRisk: string[];
  /** A requested npm version/range that could not be resolved exactly. */
  unresolvedVersions: { package: string; requestedVersion: string | null }[];
}

// ── Failure diagnosis (Lurq-specific) ───────────────────────────────────────

export type LurqDiagnosis =
  | 'index-coverage'
  | 'category-quality'
  | 'retrieval'
  | 'ranking'
  | 'planning'
  | 'compatibility-evidence'
  | 'resolver-environment';

// ── Result row ──────────────────────────────────────────────────────────────

export type ParticipantKind = 'lurq' | 'openai' | 'anthropic' | 'gemini' | 'openai-with-lurq' | 'anthropic-with-lurq' | 'gemini-with-lurq';

export interface BenchmarkResult {
  runId: string;
  participant: { id: string; kind: ParticipantKind; model: string | null };
  caseId: string;
  trial: number;
  /**
   * Fixture label for failure-detection suites (`pass` = clean control,
   * `fail` = known-bad stack). Null for stack-selection suites.
   * Ground truth for recall/precision — not inferred from E2B alone.
   */
  expectedOutcome: 'pass' | 'fail' | null;
  proposal: StackProposal | null;
  normalization: NormalizedProposal | null;
  /** Exact package versions selected for the E2B install, when resolved. */
  resolvedSelections: ResolvedSelection[] | null;
  packageValidity: PackageValidity;
  coverage: CoverageResult;
  resolution: ResolutionOutcome | null;
  compatPrediction: 'compatible' | 'conflict' | 'unknown';
  timestamps: { startedAt: string; finishedAt: string };
  participantError: string | null;
  lurqDiagnosis: LurqDiagnosis | null;
  rawProposalPath: string | null;
}

// ── Metrics (7 measurable in stack-selection-v1) ────────────────────────────

export interface BenchmarkMetrics {
  packageExistenceRate: number;
  packageRiskRate: number;
  /** Filled fixture slots / required fixture slots. Not semantic coverage. */
  requirementSlotFillRate: number;
  resolutionSuccessRate: number;
  runtimeLoadSuccessRate: number;
  /** Slot-filled sets that pass validity, install, and all runtime smoke-loads. */
  coinstallableSlotFilledRate: number;
  unknownRate: number;
  /** Requires independent human or blinded evaluator review; not automated. */
  semanticValidStackRate: number | null;
  failureDetectionRecall: number | null;
  failureDetectionPrecision: number | null;
  measurementStatus: string;
}

// ── Manifest ────────────────────────────────────────────────────────────────

export interface BenchmarkManifest {
  gitSha: string;
  suite: string;
  suiteSchemaVersion: number;
  packageCount: number;
  oldestDataAsOf: string;
  newestDataAsOf: string;
  missingCategoryCount: number;
  missingLatestVersionCount: number;
  missingEmbeddingCount: number;
  /** A schema/readiness probe for compatibility evidence. */
  compatEdgeCount: number;
  e2bTemplate: string;
  nodeVersionInE2B: string;
  npmVersionInE2B: string;
  scriptsFree: true;
}

// ── Participant interface ───────────────────────────────────────────────────

export interface Participant {
  id: string;
  kind: ParticipantKind;
  model: string | null;
  run(db: Database, benchCase: BenchmarkCase): Promise<StackProposal>;
}
