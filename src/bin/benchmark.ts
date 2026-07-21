#!/usr/bin/env node
/**
 * Benchmark runner entry point.
 *
 * Exposes two commands:
 *   1. benchmark:validate — Validate a suite file for structural correctness.
 *   2. benchmark:run — Run a participant against a suite.
 *
 * Hard requirements:
 *   - E2B_API_KEY must be set (unless --dry-run)
 *   - E2B_TEMPLATE must be in immutable "template:build-id" form (unless --dry-run)
 *   - Sandbox driver must self-report as 'e2b' (unless --dry-run)
 */
import { Command } from 'commander';
import { loadEnv, getConfig } from '../core/config';
import { getSandbox } from '../sandbox';
import { createDb } from '../db/client';
import { logger } from '../core/logger';
import { loadCases } from '../benchmark/loadCases';
import { normalizeProposal, evaluateCoverage } from '../benchmark/normalize';
import { resolveProposal } from '../benchmark/resolve';
import {
  collectManifest,
  dryRunManifest,
  ensureRunDir,
  makeRunId,
  writeLine,
  writeManifest,
  writeRaw,
  writeSummary,
  validateTemplate,
} from '../benchmark/results';
import { LurqPlanParticipant } from '../benchmark/participants/lurq';
import { OpenAIParticipant } from '../benchmark/participants/openai';
import { AnthropicParticipant } from '../benchmark/participants/anthropic';
import { GeminiParticipant } from '../benchmark/participants/gemini';
import { OpenAIWithLurqParticipant } from '../benchmark/participants/openaiWithLurq';
import { AnthropicWithLurqParticipant } from '../benchmark/participants/anthropicWithLurq';
import { GeminiWithLurqParticipant } from '../benchmark/participants/geminiWithLurq';
import type { BenchmarkResult, Participant } from '../benchmark/types';

loadEnv();

const program = new Command();
program.name('benchmark').description('Lurq Benchmark Runner');

// ── Validate Command ────────────────────────────────────────────────────────

program
  .command('validate')
  .description('Validate a suite JSON file')
  .argument('[suite]', 'Suite name (e.g. stack-selection-v1)', 'stack-selection-v1')
  .action((suiteName) => {
    try {
      const suite = loadCases(suiteName);
      console.log(`✓ Suite "${suite.suite}" (schema v${suite.schemaVersion}) loaded cleanly.`);
      console.log(`  - Cases: ${suite.cases.length}`);
      if (suite.failureCases?.length) {
        console.log(`  - Failure-detection cases: ${suite.failureCases.length}`);
      }
      console.log(`  - Runtime: Node ${suite.runtime.node}, ${suite.runtime.packageManager}`);
      
      let totalRequiredNeeds = 0;
      const categories = new Set<string>();
      
      for (const c of suite.cases) {
        for (const n of c.needs) {
          if (n.required) totalRequiredNeeds++;
          if (n.category) categories.add(n.category);
        }
      }
      
      console.log(`  - Total required needs: ${totalRequiredNeeds}`);
      console.log(`  - Categories covered: ${categories.size}`);
      process.exit(0);
    } catch (err) {
      console.error(`✗ Validation failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ── Run Command ─────────────────────────────────────────────────────────────

program
  .command('run')
  .description('Run a participant against a suite')
  .requiredOption('--suite <name>', 'Suite name (e.g. stack-selection-v1)')
  .requiredOption('--participants <ids>', 'Comma-separated participant IDs (e.g. openai:gpt-5.6-sol,lurq-plan)')
  .option('--trials <number>', 'Number of trials per case', '1')
  .option('--plan-retries <number>', 'Extra planning attempts after a participant error (default 2)', '2')
  .option('--cases <ids>', 'Comma-separated case IDs to run (runs all if omitted)')
  .option('--dry-run', 'Skip E2B and registry writes (plan + normalize only)')
  .action(async (options) => {
    const isDryRun = Boolean(options.dryRun);
    const trials = parseInt(options.trials, 10);
    if (isNaN(trials) || trials < 1) {
      console.error('ERROR: --trials must be a positive integer.');
      process.exit(1);
    }
    const planRetries = parseInt(options.planRetries, 10);
    if (isNaN(planRetries) || planRetries < 0) {
      console.error('ERROR: --plan-retries must be a non-negative integer.');
      process.exit(1);
    }

    const config = getConfig();

    // In dry-run mode, we bypass E2B guards.
    let sandbox = null;
    if (!isDryRun) {
      if (!config.E2B_API_KEY) {
        console.error('ERROR: E2B_API_KEY is required for benchmark:run. Set it in .env.');
        process.exit(1);
      }
      try {
        validateTemplate(config.E2B_TEMPLATE);
      } catch (err) {
        console.error(`ERROR: ${(err as Error).message}`);
        process.exit(1);
      }
      
      sandbox = await getSandbox();
      if (sandbox.name !== 'e2b') {
        console.error('ERROR: Benchmark requires the e2b driver. E2B_API_KEY must be set.');
        process.exit(1);
      }
    }

    // Load suite
    let suite;
    try {
      suite = loadCases(options.suite);
    } catch (err) {
      console.error(`ERROR loading suite: ${(err as Error).message}`);
      process.exit(1);
    }

    // Resolve participants
    const activeParticipants: Participant[] = [];
    const ids = options.participants.split(',').map((s: string) => s.trim());
    
    for (const id of ids) {
      if (id === 'lurq-plan') {
        activeParticipants.push(new LurqPlanParticipant());
      } else if (id.startsWith('openai-with-lurq:')) {
        activeParticipants.push(new OpenAIWithLurqParticipant(id, id.split(':')[1]!));
      } else if (id.startsWith('anthropic-with-lurq:')) {
        activeParticipants.push(new AnthropicWithLurqParticipant(id, id.split(':')[1]!));
      } else if (id.startsWith('gemini-with-lurq:')) {
        activeParticipants.push(new GeminiWithLurqParticipant(id, id.split(':')[1]!));
      } else if (id.startsWith('openai:')) {
        activeParticipants.push(new OpenAIParticipant(id, id.split(':')[1]!));
      } else if (id.startsWith('anthropic:')) {
        activeParticipants.push(new AnthropicParticipant(id, id.split(':')[1]!));
      } else if (id.startsWith('gemini:')) {
        activeParticipants.push(new GeminiParticipant(id, id.split(':')[1]!));
      } else {
        console.error(`ERROR: Unknown participant format "${id}".`);
        process.exit(1);
      }
    }

    // Init DB (we use it even in dry-run for some read-only lookups, though
    // Lurq's heuristic planner does DB reads).
    const dbHandle = createDb();
    const db = dbHandle.db;

    // Setup output dir
    const runId = makeRunId(options.suite);
    const runDir = ensureRunDir(runId);
    console.log(`Starting run: ${runId}`);
    if (isDryRun) console.log(`[DRY RUN] Bypassing E2B and registry writes.`);

    // Manifest
    const manifest = isDryRun 
      ? dryRunManifest(suite)
      : await collectManifest(db, suite, config, sandbox);
    writeManifest(runDir, manifest);

    const allResults: BenchmarkResult[] = [];

    // Branch based on schema version
    if (suite.schemaVersion === 2 && suite.failureCases) {
      console.log('\\n--- Failure Detection Suite Evaluation ---');
      for (const failureCase of suite.failureCases) {
        console.log(`Evaluating "${failureCase.id}" ...`);
        const startedAt = new Date().toISOString();
        const result: BenchmarkResult = {
          runId,
          participant: { id: 'lurq', kind: 'lurq', model: null },
          caseId: failureCase.id,
          trial: 1,
          expectedOutcome: failureCase.expectedResult,
          proposal: null,
          normalization: null,
          resolvedSelections: null,
          packageValidity: { existing: 0, nonexistent: [], deprecated: [], archived: [], highRisk: [], unresolvedVersions: [] },
          coverage: { kind: 'slot-fill', required: 0, covered: 0, threshold: 0, missing: [] },
          resolution: null,
          compatPrediction: 'unknown',
          timestamps: { startedAt, finishedAt: '' },
          participantError: null,
          lurqDiagnosis: null,
          rawProposalPath: null,
        };

        try {
          const fakeProposal: any = {
            selections: failureCase.stack.map(pkgStr => {
              let pkgName = pkgStr;
              let version: string | null = null;
              
              // Handle scoped packages correctly (e.g. @mui/material@5)
              const atIndex = pkgStr.indexOf('@', 1);
              if (atIndex !== -1) {
                pkgName = pkgStr.substring(0, atIndex);
                version = pkgStr.substring(atIndex + 1);
              }
              
              return {
                needId: 'n/a',
                package: pkgName,
                requestedVersion: version,
                scopeHint: 'runtime',
                category: null,
                lurqHealthScore: null,
                lurqConfidence: null,
                lurqSwappedFrom: null,
                source: 'fixture',
              };
            }),
            unmatchedNeedIds: [],
          };
          result.proposal = fakeProposal;
          const normalized = normalizeProposal(fakeProposal);
          result.normalization = normalized;
          
          const resolutionResult = await resolveProposal(
            db,
            sandbox,
            normalized,
            manifest.e2bTemplate,
            {
              dryRun: isDryRun,
              node:
                manifest.nodeVersionInE2B !== 'unknown' &&
                manifest.nodeVersionInE2B !== 'dry-run'
                  ? manifest.nodeVersionInE2B.replace(/^v/i, '')
                  : suite.runtime.node,
            }
          );
          result.packageValidity = resolutionResult.packageValidity;
          result.compatPrediction = resolutionResult.compatPrediction;
          result.resolution = resolutionResult.resolution;
          result.resolvedSelections = resolutionResult.resolvedSelections;
        } catch (err) {
          result.participantError = String(err);
          result.lurqDiagnosis = 'resolver-environment';
          console.error(`  ✗ Error: ${(err as Error).message}`);
        }

        result.timestamps.finishedAt = new Date().toISOString();
        writeLine(runDir, result);
        allResults.push(result);
        
        if (!result.participantError) {
          const valid = result.packageValidity.existing;
          const total = valid + result.packageValidity.nonexistent.length;
          const resolved = result.resolution?.installed ? 'yes' : (isDryRun ? 'dry' : 'no');
          const predicted =
            result.packageValidity.nonexistent.length > 0 ||
            result.packageValidity.deprecated.length > 0 ||
            result.packageValidity.archived.length > 0 ||
            result.packageValidity.highRisk.length > 0 ||
            result.packageValidity.unresolvedVersions.length > 0 ||
            (result.normalization?.invalidNames.length ?? 0) > 0 ||
            result.compatPrediction === 'conflict'
              ? 'fail'
              : 'pass';
          const labelMatch = predicted === failureCase.expectedResult ? 'hit' : 'miss';
          console.log(
            `  → Expected: ${failureCase.expectedResult} | Lurq: ${predicted} (${labelMatch}) | Pkg: ${valid}/${total} exist | Resolves: ${resolved} | Compat: ${result.compatPrediction}`,
          );
        }
      }
      
      writeSummary(runDir, allResults);
      await dbHandle.close();
      console.log(`\\nRun complete. Results written to: artifacts/benchmarks/${runId}/`);
      process.exit(0);
    }

    // Phase 1: Planning
    console.log('\\n--- Phase 1: Planning ---');
    const plans: { participant: Participant, benchCase: typeof suite.cases[number]; trial: number; result: BenchmarkResult }[] = [];
    
    for (const participant of activeParticipants) {
      console.log(`\\n>> Planning for participant: ${participant.id} <<`);
      for (const benchCase of suite.cases) {
        for (let trial = 1; trial <= trials; trial++) {
          console.log(`Case "${benchCase.id}" (Trial ${trial}/${trials}) ...`);
          const startedAt = new Date().toISOString();
          
          const result: BenchmarkResult = {
            runId,
            participant: {
              id: participant.id,
              kind: participant.kind,
              model: participant.model,
            },
            caseId: benchCase.id,
            trial,
            expectedOutcome: null,
            proposal: null,
            normalization: null,
            resolvedSelections: null,
            packageValidity: { existing: 0, nonexistent: [], deprecated: [], archived: [], highRisk: [], unresolvedVersions: [] },
            coverage: { kind: 'slot-fill', required: 0, covered: 0, threshold: 0, missing: [] },
            resolution: null,
            compatPrediction: 'unknown',
            timestamps: { startedAt, finishedAt: '' },
            participantError: null,
            lurqDiagnosis: null,
            rawProposalPath: `raw/${participant.id.replace(/:/g, '-')}-${benchCase.id}-trial-${trial}.json`,
          };

          const maxAttempts = 1 + planRetries;
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
              const proposal = await participant.run(db, benchCase);
              result.proposal = proposal;
              result.participantError = null;
              writeRaw(runDir, `${participant.id.replace(/:/g, '-')}-${benchCase.id}`, trial, proposal);
              if (attempt > 1) {
                console.log(`  ✓ recovered on attempt ${attempt}/${maxAttempts}`);
              }
              break;
            } catch (err) {
              result.participantError = String(err);
              if (result.participantError.includes('Slot need text')) {
                result.lurqDiagnosis = 'planning';
              }
              const msg = (err as Error).message;
              if (attempt < maxAttempts) {
                console.error(`  ↻ attempt ${attempt}/${maxAttempts} failed: ${msg}`);
                console.log(`  retrying planning...`);
              } else {
                console.error(`  ✗ Error after ${maxAttempts} attempt(s): ${msg}`);
              }
            }
          }

          plans.push({ participant, benchCase, trial, result });
        }
      }
    }

    // Phase 2: Evaluation
    console.log('\\n--- Phase 2: Evaluation ---');
    for (const { participant, benchCase, trial, result } of plans) {
      if (result.participantError || !result.proposal) {
         result.timestamps.finishedAt = new Date().toISOString();
         writeLine(runDir, result);
         allResults.push(result);
         continue;
      }
      
      console.log(`Evaluating [${participant.id}] "${benchCase.id}" (Trial ${trial}/${trials}) ...`);
      
      try {
        const normalized = normalizeProposal(result.proposal);
        result.normalization = normalized;
        result.coverage = evaluateCoverage(benchCase, result.proposal);
        
        const resolutionResult = await resolveProposal(
          db,
          sandbox,
          normalized,
          manifest.e2bTemplate,
          {
            dryRun: isDryRun,
            node:
              manifest.nodeVersionInE2B !== 'unknown' &&
              manifest.nodeVersionInE2B !== 'dry-run'
                ? manifest.nodeVersionInE2B.replace(/^v/i, '')
                : suite.runtime.node,
          }
        );
        result.packageValidity = resolutionResult.packageValidity;
        result.compatPrediction = resolutionResult.compatPrediction;
        result.resolution = resolutionResult.resolution;
        result.resolvedSelections = resolutionResult.resolvedSelections;

        if (!result.proposal.selections.length) {
           result.lurqDiagnosis = 'planning'; 
        }
      } catch (err) {
        if (!result.participantError) {
          result.participantError = String(err);
          result.lurqDiagnosis = 'resolver-environment';
          console.error(`  ✗ Error: ${(err as Error).message}`);
        }
      }

      result.timestamps.finishedAt = new Date().toISOString();
      writeLine(runDir, result);
      allResults.push(result);
      
      if (!result.participantError) {
        const covered = result.coverage.covered;
        const req = result.coverage.required;
        const valid = result.packageValidity.existing;
        const total = valid + result.packageValidity.nonexistent.length;
        const resolved = result.resolution?.installed ? 'yes' : (isDryRun ? 'dry' : 'no');
        console.log(`  → Slots: ${covered}/${req} | Pkg: ${valid}/${total} exist | Resolves: ${resolved}`);
      }
    }

    // Write final summary
    writeSummary(runDir, allResults);
    await dbHandle.close();
    console.log(`\nRun complete. Results written to: artifacts/benchmarks/${runId}/`);
    process.exit(0);
  });

program.parseAsync(process.argv).catch((err) => {
  logger.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
