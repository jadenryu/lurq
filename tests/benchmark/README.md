# Lurq benchmark v1 runbook

This is the operational plan for the first benchmark pilot. It is intentionally
narrow: it measures dependency-stack selection and preflight failure detection.
It does **not** claim that an agent can build a complete production application.

## The v1 claim

> Lurq helps coding agents select more valid JavaScript/TypeScript dependency
> stacks and identifies known dependency risks before installation.

Never state that Lurq "guarantees compilation," eliminates every failure, or is
better than a frontier model at general software engineering.

## What is frozen now

- Suite: `tests/benchmark/stack-selection-v1.json`
- Cases: 12
- Runtime: Node 20 + npm in E2B
- Pilot participant: Lurq only, one trial per case
- First external-model run: three trials per participant and case

The original `tests/integration/bakeoff-specs.json` and `bakeoff_results.json`
are historical prototypes. Do not use them for an external claim.

## Required environment

The local Lurq project `.env` must contain:

```dotenv
DATABASE_URL=postgresql://...
E2B_API_KEY=e2b_...
E2B_TEMPLATE=lurq-benchmark-node20-v1:d0f56b7c-f3e4-477b-abb4-092bf3d4cf93
```

The E2B template reference must be an exact build ID, not the moving public
`base` template or a mutable tag.

When external models are added, keep secrets in `.env` and record non-secret
model configuration in the benchmark run artifact:

```dotenv
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
```

Never commit a `.env`, a key, raw provider response containing credentials, or
an E2B access token.

## Data snapshot before every run

Before executing a benchmark, record:

- Git commit SHA
- benchmark suite and schema version
- package count
- oldest and newest package `data_as_of`
- package records missing latest version, category, peer-dependency metadata, or embedding
- E2B template build ID
- Node and npm version inside E2B
- provider/model IDs, temperature, tool permissions, and trial count

This is essential. A recommendation benchmark without a data snapshot cannot be
reproduced after npm packages, models, or Lurq's index change.

## Result model

Every participant/case/trial must produce one durable row with these sections:

```json
{
  "runId": "2026-07-19T00-00-00Z-stack-selection-v1",
  "participant": { "id": "lurq-plan", "kind": "lurq", "model": null },
  "caseId": "typed-saas-next",
  "trial": 1,
  "proposal": { "packages": [] },
  "normalization": {
    "duplicateNames": [],
    "invalidNames": [],
    "runtimePackages": [],
    "developmentPackages": []
  },
  "packageValidity": {
    "existing": 0,
    "nonexistent": [],
    "deprecated": [],
    "archived": [],
    "highRisk": []
  },
  "coverage": {
    "required": 0,
    "covered": 0,
    "missing": []
  },
  "resolution": {
    "template": "lurq-benchmark-node20-v1:<build-id>",
    "installed": false,
    "loaded": [],
    "durationMs": 0,
    "failureClass": null
  },
  "compatPrediction": "compatible|conflict|unknown",
  "timestamps": { "startedAt": "", "finishedAt": "" }
}
```

`npm install` success is only one field. It must never be reported as a full
stack success by itself.

## Metrics

Report these separately:

| Metric | Meaning |
| --- | --- |
| Package existence rate | Fraction of proposed names that exist on npm. |
| Package risk rate | Fraction of proposed packages that are deprecated, archived, or high risk. |
| Requirement coverage | Required capabilities covered / required capabilities. |
| Resolution success rate | Exact package set successfully installs in E2B. |
| Runtime-load success rate | Relevant runtime packages load successfully. |
| Valid-stack rate | Stack meets coverage threshold, has no blocking validity issue, and resolves. |
| Failure-detection recall | Actual failures flagged by Lurq / all actual failures. |
| Failure-detection precision | Correct Lurq flags / all Lurq flags. |
| Unknown rate | Cases where Lurq honestly lacks sufficient evidence. |

Do not silently turn `unknown` into `compatible`.

## Implementation order

### 1. Add benchmark contracts and fixture loading

Create these modules:

```text
src/benchmark/types.ts
src/benchmark/loadCases.ts
src/benchmark/normalize.ts
src/benchmark/results.ts
tests/benchmark/cases.test.ts
tests/benchmark/normalize.test.ts
```

The contracts should express `BenchmarkCase`, `StackProposal`, `NormalizedProposal`,
`ResolutionOutcome`, and `BenchmarkResult`. The loader must reject duplicate case
IDs, unknown categories, empty required needs, and invalid Node/runtime settings.

Add scripts only after those tests pass:

```json
{
  "benchmark:validate": "tsx src/bin/benchmark.ts validate",
  "benchmark:run": "tsx src/bin/benchmark.ts run"
}
```

### 2. Replace the old flat-list result semantics

The current `src/bin/bakeoff.ts` is a prototype. Do not extend it directly.
Create a new `src/bin/benchmark.ts` that writes results under:

```text
artifacts/benchmarks/<run-id>/
  manifest.json
  results.jsonl
  summary.json
  summary.csv
```

Add this to `.gitignore`:

```gitignore
artifacts/benchmarks/
```

Never overwrite `bakeoff_results.json`; preserve it as a prototype record.

### 3. Implement Lurq as the first participant

The first participant calls `handlePlan` with the fixture's structured `needs`,
not the raw document. This removes LLM-based decomposition as a confounder while
testing retrieval, ranking, package coverage, and compatibility optimization.

The first intended command, after implementation, is:

```bash
npm run benchmark:validate
npm run benchmark:run -- --suite stack-selection-v1 --participant lurq-plan --trials 1
```

For every Lurq failure, assign exactly one primary diagnosis:

```text
index-coverage
category-quality
retrieval
ranking
planning
compatibility-evidence
resolver-environment
```

This is how the benchmark becomes a product-improvement loop.

### 4. Add package validity and E2B resolution

Normalize a proposal before it reaches E2B:

```text
1. Validate legal npm package names.
2. Remove duplicates while retaining where each package came from.
3. Separate runtime packages from development/tooling packages.
4. Resolve exact versions and record them.
5. Call Lurq verify on every package.
6. Run a fresh E2B install against the exact list.
7. Smoke-load only relevant runtime packages.
```

Do not import CLIs, type-only packages, or build tools simply because they were
installed. Their import failure does not necessarily mean a product failure.

Classify a failed run as one of:

```text
nonexistent-package
invalid-package-name
peer-dependency-conflict
engine-conflict
install-script-failure
native-build-failure
runtime-load-failure
timeout
unknown-resolution-failure
```

### 5. Add external model participants

Only after Lurq-only calibration is stable, add a common participant interface:

```text
OpenAIParticipant
AnthropicParticipant
GeminiParticipant
LurqPlanParticipant
ModelWithLurqParticipant
```

Every participant receives the same case document and returns the same
`StackProposal` schema. Record the exact provider model ID and temperature.

Run unaided models with no web search and no tools. Then run the same model with
Lurq MCP access. The latter is the product comparison that matters.

Pilot command shape after implementation:

```bash
npm run benchmark:run -- \
  --suite stack-selection-v1 \
  --participants openai:<model>,anthropic:<model>,gemini:<model>,lurq-plan \
  --trials 3
```

### 6. Add `failure-detection-v1` after stack selection works

Create a separate suite containing positive and negative controls:

```text
nonexistent names
typos of popular package names
deprecated packages
Node engine mismatches
declared peer-range conflicts
sandbox-proven conflicts
clean compatible controls
```

For every item, compare Lurq's `verify`/`compat` prediction with the actual
registry or E2B outcome. Report true positives, false positives, false
negatives, true negatives, and unknowns.

### 7. Add end-to-end agent builds last

Start with three cases only. Give the same model the same PRD, terminal budget,
time limit, and starter repository both with and without Lurq MCP tools.

The evaluator—not the agent—owns the acceptance commands:

```bash
npm ci
npm run typecheck
npm test
npm run build
```

This tests agents plus dependency choices. It is valuable, but it is not a
pure package-selection benchmark, so report it separately.

## Rerun policy

- Lurq-only development run: one trial per case.
- First external-model pilot: three trials per case and participant.
- Public result: at least five trials, frozen suite, frozen E2B build, exact
  model IDs, and a recorded Lurq data snapshot.
- Re-run targeted compatibility checks when package versions change.
- Never compare results across a changed suite/schema version without clearly
  labeling the change.

## Public reporting checklist

Before publishing any chart, confirm all of the following:

```text
[ ] Suite version and 12 cases are frozen.
[ ] Every run uses the same Node 20 E2B build ID.
[ ] Every participant receives an equivalent task.
[ ] Exact model IDs and trial counts are disclosed.
[ ] Install success is not presented as architecture correctness.
[ ] Coverage, validity, resolution, and detection metrics are separated.
[ ] Unknown evidence is disclosed rather than counted as a pass.
[ ] Raw artifacts are retained for audit.
```
