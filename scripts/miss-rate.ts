/**
 * Runs the M0 miss-rate benchmark and prints the aggregate per model.
 *
 *   npx tsx scripts/miss-rate.ts [suite] [model,model,...]
 *   npx tsx scripts/miss-rate.ts miss-rate-v1 claude-opus-5,claude-sonnet-5
 *
 * The question, from src/benchmark/missRate.ts: how often does model-authored
 * code reference symbols that are ABSENT from the version the prompt pinned?
 * A referenced symbol the version does not export is a miss — the import throws
 * or the call is undefined.
 *
 * Reads the suite, generates one module per case per model, scans the result
 * against the real tier-A surface at that exact version, and reports the share
 * of referenced symbols that do not exist.
 *
 * THE LIMITS TRAVEL WITH THE NUMBER. missRate.ts lists three and they are not
 * footnotes: there is no human baseline, so this measures magnitude and cannot
 * pass or fail a gate; these are models in a harness rather than agents in a
 * loop, and a real agent might run `tsc` and self-correct; and a miss is not a
 * certain failure, because the code may never execute that path. Unverifiable
 * cases are printed separately and excluded from the rate rather than counted
 * as successes.
 *
 * Costs real API calls — one generation per case per model.
 */
import { readFile } from 'node:fs/promises';
import { config } from 'dotenv';
import { scoreCase } from '../src/benchmark/missRate';
import type { CaseResult, MissRateCase } from '../src/benchmark/missRate';

config();

const suite = process.argv[2] ?? 'miss-rate-v1';
const models = (process.argv[3] ?? 'claude-opus-5').split(',');

const raw = JSON.parse(await readFile(`tests/benchmark/${suite}.json`, 'utf8')) as
  | MissRateCase[]
  | { cases: MissRateCase[] };
const cases = Array.isArray(raw) ? raw : raw.cases;

console.error(`suite ${suite}: ${cases.length} cases x ${models.length} model(s)\n`);

for (const model of models) {
  const results: CaseResult[] = [];
  for (const c of cases) {
    const r = await scoreCase(c, model);
    results.push(r);
    const verdict = r.unverifiable
      ? `unverifiable — ${r.unverifiable}`
      : `${r.missing.length}/${r.referenced.length} missing` +
        (r.missing.length ? `  [${r.missing.join(', ')}]` : '');
    console.error(`  ${r.id.padEnd(26)} ${r.package.padEnd(22)} ${verdict}`);
  }

  const scored = results.filter((r) => !r.unverifiable);
  const referenced = scored.reduce((a, r) => a + r.referenced.length, 0);
  const missing = scored.reduce((a, r) => a + r.missing.length, 0);
  const casesWithAMiss = scored.filter((r) => r.missing.length > 0).length;

  console.error(
    `\n  ${model}\n` +
      `    scored cases       ${scored.length} of ${results.length}` +
      ` (${results.length - scored.length} unverifiable)\n` +
      `    symbols referenced ${referenced}\n` +
      `    symbols missing    ${missing}\n` +
      `    SYMBOL MISS RATE   ${referenced ? ((missing / referenced) * 100).toFixed(1) : 'n/a'}%\n` +
      `    cases with >=1 miss ${casesWithAMiss} of ${scored.length}` +
      ` (${scored.length ? ((casesWithAMiss / scored.length) * 100).toFixed(0) : 'n/a'}%)\n`,
  );
}
