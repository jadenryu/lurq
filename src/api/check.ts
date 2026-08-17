/**
 * `lurq check-api` — read two revisions of a spec from git and rule on the diff.
 *
 * Runs entirely on the developer's machine or their CI runner, like
 * `check-upgrade` and `check-release`: git is the only thing it talks to, no API
 * key, no network to lurq. The spec is a description of a public interface and
 * still never leaves the process.
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { checkApi, type ApiCheck } from './diff';
import { extractApiSurface } from './openapi';

const execFileP = promisify(execFile);

/** Conventional spec filenames, in the order a repo usually means them. */
const CANDIDATES = [
  'openapi.yaml',
  'openapi.yml',
  'openapi.json',
  'swagger.yaml',
  'swagger.yml',
  'swagger.json',
  'api/openapi.yaml',
  'api/openapi.yml',
  'api/openapi.json',
  'docs/openapi.yaml',
  'docs/openapi.yml',
];

/** The spec to check, when the user didn't name one. */
export function findSpec(dir: string): string | null {
  for (const candidate of CANDIDATES) {
    const full = resolve(dir, candidate);
    if (existsSync(full)) return full;
  }
  return null;
}

/**
 * The file's content at a git revision, or null when it did not exist there.
 *
 * A spec that is new in this revision is not a failure — it is an API with no
 * previous promises to break — so "not in that revision" has to be
 * distinguishable from "git blew up", which is why this returns null rather than
 * an empty string.
 */
async function showAtRevision(
  dir: string,
  rev: string,
  repoPath: string,
): Promise<string | null> {
  try {
    const { stdout } = await execFileP('git', ['show', `${rev}:${repoPath}`], {
      cwd: dir,
      maxBuffer: 32 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return null;
  }
}

export interface ApiCheckResult extends ApiCheck {
  /** The spec that was read, relative to the working directory. */
  spec: string;
  /** The revision compared against. */
  against: string;
}

/**
 * Compare the working tree's spec against the same file at `against`.
 *
 * `HEAD` is the default because the common case is a change you have not
 * committed yet; CI passes the base branch instead.
 */
export async function runApiCheck(
  dir: string,
  opts: { spec?: string; against?: string } = {},
): Promise<ApiCheckResult> {
  const against = opts.against ?? 'HEAD';
  const specPath = opts.spec ? resolve(dir, opts.spec) : findSpec(dir);
  const spec = specPath ? relative(dir, specPath) || specPath : '(none found)';
  const base = { spec, against, title: null, fromVersion: null, toVersion: null };

  if (!specPath) {
    return {
      ...base,
      verdict: 'inconclusive',
      versionCovers: null,
      diff: {
        breaking: [],
        other: [],
        inconclusive: `no OpenAPI document found in ${dir}. Name one: lurq check-api <file>`,
      },
    };
  }

  const current = extractApiSurface(readFileSync(specPath, 'utf8'), spec);
  const previousSource = await showAtRevision(dir, against, spec);
  if (previousSource === null) {
    return {
      ...base,
      title: current.title,
      toVersion: current.version,
      verdict: 'inconclusive',
      versionCovers: null,
      diff: {
        breaking: [],
        other: [],
        inconclusive: `${spec} does not exist at ${against}, so there is nothing to compare against`,
      },
    };
  }

  const previous = extractApiSurface(previousSource, `${spec} at ${against}`);
  return { ...base, ...checkApi(previous, current) };
}
