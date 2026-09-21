/**
 * Environment variables the code reads and nothing declares.
 *
 * The "works on my machine" failure: a module reads `process.env.STRIPE_KEY`,
 * the author has it exported in their shell, and `.env.example` never learned
 * about it. Everyone who clones the repo gets a runtime error at whatever
 * moment that code path first runs, which is rarely at startup.
 *
 * Three decisions carry this file:
 *
 *   - Reads are found through the TypeScript AST, not a regex. `process.env.X`
 *     inside a comment, a string, or a doc block is not a read, and a detector
 *     that counts those produces findings nobody can act on.
 *   - Declared names come from an explicit list of `.env*` files at the root,
 *     not a directory walk. The walkers here skip dotfiles, and `.env` itself
 *     is normally gitignored, so a walk would silently see nothing and report
 *     every variable as undeclared.
 *   - An ambient allowlist is mandatory, not politeness. `NODE_ENV`, `CI`,
 *     `PORT` and the `GITHUB_*` family are supplied by the platform and belong
 *     in no `.env.example`. Reporting them makes the check noise, and a noisy
 *     check gets switched off — which costs more than never shipping it.
 *
 * VALUES ARE NEVER READ. A declared name is the text left of the first `=`;
 * what follows is not parsed, not stored, and cannot reach a finding. That is
 * also why `dotenv` is not used here despite being a dependency: it exists to
 * produce values.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { listSourceFiles } from '../surface/references';
import type { Finding } from './types';

/**
 * Files that declare what a project expects, in precedence-free order: any of
 * them naming a variable is enough for it to be declared somewhere.
 *
 * `.env` is included and read for NAMES ONLY. Leaving it out would report every
 * variable as undeclared on a machine that is correctly configured.
 */
const ENV_FILES = ['.env.example', '.env.sample', '.env.template', '.env.defaults', '.env'];

/** Supplied by the platform, the runtime, or CI. Never declared by a project. */
const AMBIENT = new Set([
  'NODE_ENV',
  'CI',
  'PORT',
  'HOME',
  'PATH',
  'PWD',
  'TZ',
  'USER',
  'SHELL',
  'TMPDIR',
  'TEMP',
  'LANG',
  'TERM',
  'DEBUG',
  'NO_COLOR',
  'FORCE_COLOR',
  'NODE_OPTIONS',
  'NODE_ENV_FILE',
  // Windows, and the XDG base directories. Measured: a real scan reported
  // APPDATA and XDG_CONFIG_HOME as undeclared, which no project declares.
  'APPDATA',
  'LOCALAPPDATA',
  'USERPROFILE',
  'SystemRoot',
  'COMSPEC',
  'HOSTNAME',
  'LOGNAME',
  'EDITOR',
  'VISUAL',
  'COLORTERM',
]);

/** Whole families the platform owns. A prefix, because the members are endless. */
const AMBIENT_PREFIXES = [
  'npm_',
  'NPM_',
  'GITHUB_',
  'RUNNER_',
  'VERCEL_',
  'RAILWAY_',
  'AWS_',
  'GOOGLE_CLOUD_',
  'K_',
  'CF_',
  'FLY_',
  'RENDER_',
  'HEROKU_',
  'XDG_',
];

/**
 * Variables read to FIND the env file, which therefore cannot be declared in
 * it. `loadEnv()` reads LURQ_ENV_FILE to decide which file to load; declaring
 * it inside the file it selects is circular, so the finding could never be
 * cleared and reporting it is a permanent nag rather than a task.
 *
 * A convention rather than one project's quirk: dotenv reads
 * DOTENV_CONFIG_PATH for the same purpose, and the `_ENV_FILE` suffix is the
 * usual spelling elsewhere.
 */
const BOOTSTRAP = new Set(['DOTENV_CONFIG_PATH', 'DOTENV_CONFIG_ENCODING', 'ENV_FILE', 'ENV_PATH']);

const isBootstrap = (name: string): boolean => BOOTSTRAP.has(name) || name.endsWith('_ENV_FILE');

const isAmbient = (name: string): boolean =>
  AMBIENT.has(name) || isBootstrap(name) || AMBIENT_PREFIXES.some((p) => name.startsWith(p));

/** A plausible variable name, so a computed access cannot inject nonsense. */
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Files that exercise code rather than running it in anger.
 *
 * Measured, not assumed: scanning this repo reported FIXTURE_ECHO and
 * LURQ_TEST_DATABASE_URL as undeclared. Both are set by the harness that
 * spawns the code reading them, so every one of those findings was false.
 *
 * Exported because it is a general rule about where a finding is worth
 * raising, not a fact about environment variables: `model.ts` reaches the same
 * conclusion from the same evidence — a retired identifier that a test asserts
 * ON is a fixture, and rewriting it breaks the test that proves the detector
 * works. Two detectors, one definition, so they cannot drift apart.
 */
export const HARNESS_FILE = /(^|\/)(tests?|__tests__|e2e|fixtures?)\/|\.(test|spec)\.[cm]?[jt]sx?$/;

export interface EnvRead {
  name: string;
  /** Repo-relative, so a finding cites something the reader can open. */
  file: string;
  line: number;
  /**
   * The read has a fallback beside it (`process.env.X ?? 'dev'`), so the code
   * already states what happens without it. Optional by construction, and
   * reporting it as missing configuration is how this check becomes noise.
   */
  optional?: true;
}

/**
 * Every `process.env.NAME` and `process.env['NAME']` in one file.
 *
 * A dynamic access — `process.env[key]` — is deliberately ignored rather than
 * guessed at: the name is not in the source, and inventing one would be worse
 * than missing it.
 */
export function envReadsIn(file: string, text: string): EnvRead[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const out: EnvRead[] = [];

  const isProcessEnv = (node: ts.Expression): boolean =>
    ts.isPropertyAccessExpression(node) &&
    node.name.text === 'env' &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'process';

  /** `x ?? d` / `x || d` where the read is the left side: the default is stated. */
  const hasFallback = (node: ts.Node): boolean => {
    const parent = node.parent;
    return (
      !!parent &&
      ts.isBinaryExpression(parent) &&
      parent.left === node &&
      (parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        parent.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    );
  };

  const push = (name: string, node: ts.Node) => {
    if (!NAME.test(name)) return;
    out.push({
      name,
      file,
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      ...(hasFallback(node) ? { optional: true as const } : {}),
    });
  };

  const visit = (node: ts.Node): void => {
    // process.env.NAME
    if (ts.isPropertyAccessExpression(node) && isProcessEnv(node.expression)) {
      push(node.name.text, node);
    }
    // process.env['NAME'] — the same read, written differently.
    else if (
      ts.isElementAccessExpression(node) &&
      isProcessEnv(node.expression) &&
      node.argumentExpression &&
      ts.isStringLiteralLike(node.argumentExpression)
    ) {
      push(node.argumentExpression.text, node);
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return out;
}

/**
 * Variable NAMES declared by the project's env files.
 *
 * Everything right of the first `=` is ignored by construction — this function
 * has no variable holding a value, so no later change can leak one into a
 * report by accident.
 */
export function declaredNames(root: string, files: string[] = ENV_FILES): Set<string> {
  const names = new Set<string>();
  for (const file of files) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    for (const raw of text.split('\n')) {
      // A commented declaration is still a declaration. `.env.example` files
      // conventionally document optional variables as `# REDIS_URL=...`, and
      // skipping them reported twelve of this repo's own documented variables
      // as missing — measured, not supposed.
      const line = raw.trim().replace(/^#\s*/, '');
      if (!line) continue;
      // The `=` is required now that comments are read: without it, prose like
      // "# Database settings" would declare a variable called Database.
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const name = line
        .slice(0, eq)
        .replace(/^export\s+/, '')
        .trim();
      if (NAME.test(name)) names.add(name);
    }
  }
  return names;
}

export interface EnvPlan {
  findings: Finding[];
  /** Every read that was found, declared or not. For a report's denominator. */
  reads: EnvRead[];
  /** A source file past the scan limit means this cannot claim to be complete. */
  truncated: boolean;
}

export interface EnvOptions {
  limit?: number;
  /** Override the declared set, for tests and for a project with odd filenames. */
  declared?: Set<string>;
  /** Injectable reader, so tests need no fixture tree. */
  read?: (absolute: string) => string | null;
  /** Override discovery, same reason. Absolute paths. */
  files?: string[];
}

/**
 * Findings for variables the code reads that nothing declares.
 *
 * `warning`, never blocking: a read is not proof the variable is required —
 * plenty are optional with a fallback beside them — and this cannot see a
 * default that lives in a shell profile or a deployment config.
 */
export function envFindings(root: string, opts: EnvOptions = {}): EnvPlan {
  const listing = opts.files
    ? { files: opts.files, truncated: false }
    : listSourceFiles(root, opts.limit);
  const read =
    opts.read ??
    ((absolute: string) => {
      try {
        return readFileSync(absolute, 'utf8');
      } catch {
        return null;
      }
    });

  const reads: EnvRead[] = [];
  for (const absolute of listing.files) {
    const text = read(absolute);
    if (text === null) continue;
    reads.push(...envReadsIn(relative(root, absolute) || absolute, text));
  }

  const declared = opts.declared ?? declaredNames(root);
  const missing = new Map<string, EnvRead[]>();
  for (const r of reads) {
    if (isAmbient(r.name) || declared.has(r.name)) continue;
    // A name defaulted at every site needs no declaration; one unguarded read
    // anywhere makes it required, so only those sites are collected and cited.
    if (r.optional) continue;
    if (HARNESS_FILE.test(r.file)) continue;
    const list = missing.get(r.name);
    if (list) list.push(r);
    else missing.set(r.name, [r]);
  }

  const findings: Finding[] = [...missing]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, where]) => ({
      domain: 'env' as const,
      code: `env-undeclared:${name}`,
      severity: 'warning' as const,
      detail: `${name} is read by this project but declared in none of ${ENV_FILES.join(', ')} — it is set on whatever machine this works on`,
      file: where[0]!.file,
      evidence: `read at ${where
        .slice(0, 5)
        .map((r) => `${r.file}:${r.line}`)
        .join(', ')}${where.length > 5 ? ` and ${where.length - 5} more` : ''}`,
      fix: {
        summary: `declare ${name}, or get its value from the user`,
        task: {
          instruction:
            `${name} is read at the sites listed and declared nowhere. Add it to .env.example with an empty or example value ` +
            `so the next clone knows it exists. If a real value is needed to run, ask the user for it — never from a log, ` +
            'an example file, a previous run, or a guess.',
          files: [...new Set(where.map((r) => r.file))],
          evidence: [
            `${where.length} read(s)`,
            ...where.slice(0, 5).map((r) => `${r.file}:${r.line}`),
          ],
        },
        verify: ['tests'],
      },
    }));

  return { findings, reads, truncated: listing.truncated };
}
