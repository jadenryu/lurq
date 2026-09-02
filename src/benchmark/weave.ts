/**
 * Weave (Weights & Biases) mirror for benchmark runs.
 *
 * Why this exists: `artifacts/benchmarks/<run>/summary.csv` is the only record
 * that lurq moves the numbers, and nobody outside this repo can read it. Weave
 * gives the same rows a hosted comparison view, so the with-lurq and
 * without-lurq arms of a run sit side by side and each cell drills down into
 * the transcript that produced it.
 *
 * Design rules, all load-bearing:
 *
 *   1. OFF BY DEFAULT. Without both WEAVE_PROJECT and WANDB_API_KEY every
 *      function here returns immediately. Benchmarks must stay runnable
 *      offline, on a plane, with no vendor account.
 *   2. NEVER FAILS A RUN. Telemetry that can fail the measurement is worse
 *      than no telemetry. Every call is wrapped; a Weave outage degrades to a
 *      warning and the JSONL/CSV writers carry on untouched.
 *   3. ONE EVALUATION PER PARTICIPANT. `lurq-plan`, `anthropic:x` and
 *      `anthropic-with-lurq:x` are separate arms of one experiment — Weave
 *      compares Evaluations, so each participant gets its own logger and they
 *      line up in the comparison view by shared dataset + attributes.
 *   4. RUN IDENTITY IS AN ATTRIBUTE, NOT PROSE. Two benchmark numbers are only
 *      comparable if the git SHA, the E2B template, and the index's freshness
 *      match. Those are stamped on every call via client settings, so the
 *      comparison view can filter on them instead of taking a screenshot's
 *      word for it.
 *
 * The scoring predicates are imported from `results.ts` rather than restated
 * here: the mirror must never be able to disagree with summary.csv.
 */
import { computeMetrics, isCoinstallableSlotFilled, hasNoBlockingPackage, predictedFail } from './results';
import { spendFor } from './budget';
import { logger } from '../core/logger';
import type { Database } from '../db/client';
import type {
  BenchmarkCase,
  BenchmarkManifest,
  BenchmarkResult,
  BenchmarkSuite,
  Participant,
  StackProposal,
} from './types';

type WeaveModule = typeof import('weave');
type EvalLogger = InstanceType<WeaveModule['EvaluationLogger']>;

let weave: WeaveModule | null = null;
let loggers: Map<string, EvalLogger> | null = null;
let suiteName = '';

/**
 * Weave object names reject some characters with a 422, and participant ids
 * carry colons (`anthropic:claude-opus-5`). The benchmark already strips them
 * for artifact filenames (`writeRaw`); do the same before anything reaches the
 * trace server.
 */
function safeName(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'unnamed';
}


/**
 * Keep a Weave upload failure from killing the run.
 *
 * The SDK rejects with a bare `Response` when the trace server refuses a write
 * (seen: 422 from /obj/create), and nothing in the library catches it — Node's
 * default handler then takes the whole process down. Rule #2 of this module
 * says telemetry never fails a run, and a try/catch cannot honour that for a
 * promise we never receive. So the guard is process-level, but deliberately
 * narrow: it swallows only rejections carrying a Response from the trace host
 * and rethrows everything else through the default path, so a real bug in the
 * benchmark still crashes loudly.
 *
 * Losing traces is the acceptable failure here. Losing a paid benchmark run
 * two cases from the end is not.
 */
let rejectionGuardInstalled = false;
function installRejectionGuard(): void {
  if (rejectionGuardInstalled) return;
  rejectionGuardInstalled = true;
  process.on('unhandledRejection', (reason) => {
    const isTraceServer =
      reason instanceof Response && /(^|\.)wandb\.ai$/.test(new URL(reason.url || 'https://x.invalid').hostname);
    if (isTraceServer) {
      logger.warn(`Weave upload rejected (${(reason as Response).status}); trace dropped, run continues.`);
      return;
    }
    throw reason;
  });
}

/** True once `initWeave` has successfully connected. Cheap guard for hot paths. */
export function weaveEnabled(): boolean {
  return weave !== null;
}

/**
 * Connect to Weave, or stay silent. Returns whether tracing is on.
 *
 * `weave` is imported dynamically so that it is never loaded — nor required to
 * be installed — when the feature is off.
 */
export async function initWeave(
  suite: BenchmarkSuite,
  manifest: BenchmarkManifest,
  runId: string,
): Promise<boolean> {
  const project = process.env.WEAVE_PROJECT;
  if (!project || !process.env.WANDB_API_KEY) return false;

  try {
    weave = await import('weave');
    await weave.init(project, {
      // Stamped on every call this run produces — traces and eval rows alike.
      attributes: {
        runId,
        suite: suite.suite,
        suiteSchemaVersion: suite.schemaVersion,
        gitSha: manifest.gitSha,
        e2bTemplate: manifest.e2bTemplate,
        nodeInE2B: manifest.nodeVersionInE2B,
        indexPackageCount: manifest.packageCount,
        indexOldestDataAsOf: manifest.oldestDataAsOf,
        indexNewestDataAsOf: manifest.newestDataAsOf,
        compatEdgeCount: manifest.compatEdgeCount,
      },
    });
  } catch (err) {
    logger.warn(`Weave disabled: ${err instanceof Error ? err.message : String(err)}`);
    weave = null;
    return false;
  }

  installRejectionGuard();
  loggers = new Map();
  suiteName = suite.suite;
  console.log(`Weave: mirroring run to project "${project}"`);
  return true;
}

/**
 * Wrap a participant's planning call so the whole agent loop becomes one trace.
 *
 * The `db` handle is closed over rather than passed through, because `op`
 * serializes its arguments into the trace — a Drizzle client is both enormous
 * and circular, and the fixture is the only input worth recording anyway.
 */
export function tracedRun(
  participant: Participant,
  db: Database,
): (benchCase: BenchmarkCase) => Promise<StackProposal> {
  const plain = (benchCase: BenchmarkCase) => participant.run(db, benchCase);
  if (!weave) return plain;
  return weave.op(plain, {
    name: safeName(participant.id),
    opKind: 'agent',
    callDisplayName: (benchCase) => `${participant.id} · ${benchCase.id}`,
  });
}

/** Wrap one lurq MCP handler so tool calls nest under the participant's trace. */
export function tracedTool<A, R>(name: string, fn: (args: A) => Promise<R>): (args: A) => Promise<R> {
  if (!weave) return fn;
  return weave.op(fn, { name: safeName(`lurq.${name}`), opKind: 'tool' });
}

/**
 * Mirror one finished trial as a Weave prediction.
 *
 * Scores are per-trial components of the aggregates in `computeMetrics`, framed
 * so that higher is always better — a leaderboard where some columns invert is
 * a leaderboard people misread.
 */
export function logResult(result: BenchmarkResult): void {
  if (!weave || !loggers) return;

  try {
    const { id, kind, model } = result.participant;
    let ev = loggers.get(id);
    if (!ev) {
      ev = new weave.EvaluationLogger({
        name: safeName(`${suiteName}--${id}`),
        description: `lurq benchmark — ${suiteName}, participant ${id}`,
        dataset: suiteName,
        model: { name: model ?? kind },
      });
      loggers.set(id, ev);
    }

    const pred = ev.logPrediction(
      { caseId: result.caseId, trial: result.trial },
      result.participantError
        ? { error: result.participantError }
        : (result.proposal ?? {}),
    );

    // A participant that never produced a proposal scores zero on everything —
    // dropping the row instead would quietly inflate the arm that crashes most.
    pred.logScore('completed', result.participantError === null);
    pred.logScore('noHallucinatedPackage', result.packageValidity.nonexistent.length === 0);
    pred.logScore('noBlockingPackage', hasNoBlockingPackage(result));
    pred.logScore('installed', result.resolution?.installed === true);
    pred.logScore(
      'runtimeLoaded',
      result.resolution?.loaded.every((l) => l.loaded === true) ?? false,
    );
    pred.logScore('coinstallableSlotFilled', isCoinstallableSlotFilled(result));

    if (result.coverage.required > 0) {
      pred.logScore('slotFill', result.coverage.covered / result.coverage.required);
    }
    // Failure-detection suites carry a fixture label; stack-selection ones don't.
    if (result.expectedOutcome === 'pass' || result.expectedOutcome === 'fail') {
      const expectedFail = result.expectedOutcome === 'fail';
      pred.logScore('failureVerdictCorrect', predictedFail(result) === expectedFail);
    }
    pred.finish();
  } catch (err) {
    logger.warn(`Weave logResult skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Close every evaluation with the same metrics that land in summary.csv, then
 * flush. `flush` must be awaited before the runner's `process.exit(0)` —
 * buffered calls are dropped otherwise, and a run that reports success while
 * silently uploading nothing is the worst possible outcome here.
 */
export async function finishWeave(allResults: BenchmarkResult[]): Promise<void> {
  if (!weave || !loggers) return;

  try {
    for (const [id, ev] of loggers) {
      const metrics = computeMetrics(allResults.filter((r) => r.participant.id === id));
      // Nulls mean "not measurable in this suite". Weave renders them as empty
      // leaderboard columns for every arm, so drop them rather than ship noise.
      const summary: Record<string, unknown> = Object.fromEntries(
        Object.entries(metrics).filter(([, v]) => v !== null),
      );
      // What the arm cost to produce. A leaderboard without this can't answer
      // whether an arm is worth its bill — measured from provider usage, so
      // it is spend, not an estimate.
      const spend = spendFor(id);
      if (spend) {
        summary.costUsd = Number(spend.usd.toFixed(4));
        summary.inputTokens = spend.inputTokens;
        summary.outputTokens = spend.outputTokens;
        summary.providerCalls = spend.calls;
      }
      await ev.logSummary(summary);
    }
    await weave.flush();
  } catch (err) {
    logger.warn(`Weave finish incomplete: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    loggers = null;
    weave = null;
  }
}
