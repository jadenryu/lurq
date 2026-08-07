/**
 * Build gate for the hero's generated data.
 *
 *   npx tsx scripts/check-generated-content.ts
 *
 * Both artifacts must exist and both must be able to say where they came from.
 * `generatedAt` is what the hero renders its "checked <date>" line from, so a
 * stale run shows as stale instead of quietly reading as current; `source` is the
 * command or the query that produced the file, so anyone auditing the page can
 * re-run it and get the same answer.
 *
 * A missing file fails the build rather than rendering an empty panel. The page
 * makes a claim about evidence, and the one thing it must never do is make that
 * claim over data nobody generated.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Anchored to this file, not to cwd — the web workspace runs it as `prebuild`. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const REQUIRED = [
  'apps/web/src/content/hero-run.json',
  'apps/web/src/content/generated/drift.json',
] as const;

const REGENERATE: Record<string, string> = {
  'apps/web/src/content/hero-run.json': 'npx tsx scripts/gen-hero-run.ts',
  'apps/web/src/content/generated/drift.json': 'npm run content:drift',
};

async function main(): Promise<void> {
  const problems: string[] = [];

  for (const rel of REQUIRED) {
    const abs = path.join(ROOT, rel);
    let raw: string;
    try {
      raw = await readFile(abs, 'utf8');
    } catch {
      problems.push(`${rel} is missing — run: ${REGENERATE[rel]}`);
      continue;
    }

    let parsed: { generatedAt?: unknown; source?: unknown };
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch (err) {
      problems.push(`${rel} is not valid JSON (${err instanceof Error ? err.message : err})`);
      continue;
    }

    const { generatedAt, source } = parsed;

    if (typeof generatedAt !== 'string' || Number.isNaN(Date.parse(generatedAt))) {
      problems.push(`${rel} has no valid ISO generatedAt (got ${JSON.stringify(generatedAt)})`);
    }
    if (typeof source !== 'string' || source.trim() === '') {
      problems.push(`${rel} has no source string — nobody can reproduce it`);
    }
  }

  if (problems.length) {
    console.error('generated content check failed:\n');
    for (const p of problems) console.error(`  · ${p}`);
    console.error('');
    process.exit(1);
  }

  console.error(`generated content ok (${REQUIRED.length} files)`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
