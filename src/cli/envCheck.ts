/**
 * `lurq check-env` — variables this project reads and nothing declares.
 *
 * The "works on my machine" gap, as a CI gate. It reads only the project's own
 * source and its `.env*` files, needs no API key and no network, and never
 * looks at a value: a declared name is the text left of the first `=`, and the
 * rest is not parsed.
 *
 * The precision rules matter more than the detection here — a check that
 * reports `NODE_ENV` and a test fixture's own variables gets switched off, and
 * a check nobody runs is worth less than no check. See src/fix/env.ts for what
 * is excluded and why; every rule there came from a wrong finding on a real
 * repository rather than from a guess about one.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { envFindings } from '../fix/env';
import { bold, dim, yellow } from './format';

export interface EnvCheckOpts {
  json?: boolean;
  /** Write SARIF here, for GitHub code scanning. */
  sarif?: string;
  /** Exit 1 when anything is undeclared (for CI). */
  exitCode?: boolean;
  /** Source files read before the scan stops. */
  limit?: string;
}

export async function runEnvCheck(dir: string | undefined, opts: EnvCheckOpts): Promise<void> {
  const root = resolve(dir ?? process.cwd());
  const limit = opts.limit ? Number(opts.limit) : undefined;
  if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
    throw new Error(`--limit must be a positive number; got "${opts.limit}"`);
  }

  const plan = envFindings(root, { limit });
  const distinct = new Set(plan.reads.map((r) => r.name)).size;

  if (opts.sarif) {
    const { toSarif } = await import('../fix/sarif');
    const { VERSION } = await import('../core/constants');
    // No `read`: an env finding carries no edits, so no region is computed and
    // no file needs opening. The alert points at the file, not a byte range.
    const doc = toSarif(plan.findings, { version: VERSION, read: () => null });
    writeFileSync(opts.sarif, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
    console.error(`wrote ${opts.sarif}`);
  }

  if (opts.json) {
    console.log(JSON.stringify({ root, ...plan, distinct }, null, 2));
  } else {
    console.log(formatEnvCheck(root, plan, distinct));
  }

  // `truncated` is not a pass: a file past the limit is one nobody read, so a
  // clean result would be a claim about source that was never opened.
  if (opts.exitCode && (plan.findings.length > 0 || plan.truncated)) process.exitCode = 1;
}

export function formatEnvCheck(
  root: string,
  plan: ReturnType<typeof envFindings>,
  distinct: number,
): string {
  const out: string[] = [];
  const scanned = `${plan.reads.length} read(s) of ${distinct} variable(s) in ${root}`;

  if (plan.findings.length === 0) {
    out.push(`Every variable this project reads is declared or supplied by the platform.`);
    out.push(dim(scanned));
  } else {
    out.push(`${plan.findings.length} variable(s) read here and declared nowhere:`);
    for (const f of plan.findings) {
      out.push(`  ${yellow(f.code.replace('env-undeclared:', ''))}  ${dim(f.evidence ?? '')}`);
    }
    out.push('');
    out.push(
      dim('add each to .env.example so the next clone knows it exists; ask the user for any real value'),
    );
    out.push(dim(scanned));
  }

  if (plan.truncated) {
    out.push(bold('the scan stopped at its file limit, so this is not a complete answer (--limit)'));
  }
  return out.join('\n');
}
