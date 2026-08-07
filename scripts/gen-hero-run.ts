/**
 * Generates apps/web/src/content/hero-run.json from a real `lurq compat` call.
 *
 *   npx tsx scripts/gen-hero-run.ts
 *
 * The hero's terminal panel renders whatever this writes. Nothing in the output
 * is composed here: the script shells out to the CLI, parses the JSON the CLI
 * printed, and serialises it verbatim under `result`. If the CLI exits non-zero
 * or prints something unparseable, this throws and writes nothing — a stale file
 * is recoverable, an invented one is not.
 *
 * Deliberately absent: any summary counts. `compat` reports conflicts, an overall
 * grade, and stored edges; it does not report a "held" tally, and computing one
 * here would put a number on the page that the product never produced. The panel
 * has to be designed against the shape below, not the other way round.
 *
 * WRITES TO THE DATABASE. `checkCompat` enqueues a background sandbox job for any
 * pair it can't already prove (src/compat/check.ts), and members that aren't
 * indexed yet get fetched on first touch. Point LURQ_ENV_FILE at a non-production
 * env unless a production read is what you actually want.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = path.join(process.cwd(), 'apps/web/src/content/hero-run.json');

/**
 * The stack the hero checks. Recognisable, and honestly not all green: next-auth
 * pins an exact @auth/core that has since moved, and the eslint plugin trails
 * TypeScript. `next` is pinned to 15 because the claim is about a current app.
 */
const PACKAGES = [
  'next',
  '@auth/core',
  'next-auth',
  'typescript',
  '@typescript-eslint/eslint-plugin',
] as const;

/**
 * No version pins. The first cut of this script pinned next to 15, which was
 * wrong twice over: `compat` takes bare names and never splits `name@version`,
 * and `--pin next=15` is a range, which the registry lookup resolves to `latest`
 * rather than rejecting — so the run reported next@16 while the source string
 * claimed next@15. Unpinned is both simpler and more honest: this is what an
 * agent installing today actually gets, and `next` is in neither conflict.
 */
const SOURCE = ['lurq compat', ...PACKAGES].join(' ');

/** What this script actually executes, which is the same CLI from source. */
const ARGV = ['tsx', 'src/bin/lurq.ts', 'compat', ...PACKAGES, '--json'];

async function main(): Promise<void> {
  console.error(`running: ${ARGV.join(' ')}`);

  let stdout: string;
  try {
    stdout = execFileSync('npx', ARGV, {
      encoding: 'utf8',
      // compat can fetch uncached members on first touch; don't cut that short.
      timeout: 180_000,
      maxBuffer: 32 * 1024 * 1024,
      // stderr stays on the terminal so ingest warnings are visible; only
      // stdout is captured, which is where --json writes.
      stdio: ['ignore', 'pipe', 'inherit'],
    });
  } catch (err) {
    throw new Error(
      `lurq compat failed, so no file was written. Fix the command before rerunning.\n${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  let result: unknown;
  try {
    result = JSON.parse(stdout);
  } catch {
    throw new Error(
      `lurq compat --json did not print JSON. First 400 chars:\n${stdout.slice(0, 400)}`,
    );
  }

  // A run that resolved nothing is a failed run, not a result worth shipping.
  const grade = (result as { overall?: string }).overall;
  const checked = (result as { checked?: unknown[] }).checked ?? [];
  if (!grade || checked.length === 0) {
    throw new Error(
      `lurq compat returned no members (overall=${String(grade)}). Nothing written.`,
    );
  }

  const pairs = (result as { pairs?: unknown[] }).pairs ?? [];
  const expectedPairs = (checked.length * (checked.length - 1)) / 2;
  if (pairs.length !== expectedPairs) {
    throw new Error(
      `lurq compat returned ${pairs.length} pairs for ${checked.length} members; ` +
        `expected ${expectedPairs}. Nothing written.`,
    );
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    /** Re-runnable by anyone with the CLI installed. */
    source: SOURCE,
    /** How this machine invoked it, for exact reproduction from the repo. */
    invocation: `npx ${ARGV.join(' ')}`,
    /**
     * `packages` and `pairs` are lifted to the top level because they are what
     * the page renders; both are verbatim slices of the CLI's own output, not
     * anything composed here. `result` stays below them in full so the file is
     * still auditable against a re-run.
     */
    packages: checked,
    pairs,
    result,
  };

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(payload, null, 2)}\n`);

  const conflicts = (result as { conflicts?: unknown[] }).conflicts ?? [];
  const unverified = (result as { unverified?: string[] }).unverified ?? [];
  console.error(
    `wrote ${path.relative(process.cwd(), OUT)}\n` +
      `  overall:    ${grade}\n` +
      `  checked:    ${checked.length}\n` +
      `  conflicts:  ${conflicts.length}\n` +
      `  unverified: ${unverified.length ? unverified.join(', ') : 'none'}`,
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
