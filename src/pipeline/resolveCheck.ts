/**
 * Resolve-only compat check (§4C). Ask npm to *resolve* a package set without
 * installing it: `npm install --package-lock-only` builds the lockfile (or fails
 * with ERESOLVE) from registry metadata alone — no tarballs, no build, no VM.
 * This catches the version-conflict class (diamond deps, unsatisfiable peer
 * ranges) that Tier-0 declared analysis can't see, at a fraction of the
 * sandbox's cost. The sandbox is reserved for runtime proof only.
 *
 * **Why this is safe to run on our own container rather than in the sandbox.**
 * `--package-lock-only` never runs a lifecycle script — no preinstall, no
 * postinstall — because it never unpacks anything. It reads registry metadata
 * and does semver arithmetic. The one caller-controlled input that still reaches
 * the outside world is the *version specifier*: a non-semver value like
 * `git+ssh://host/repo` makes npm fetch that host's manifest. Callers must
 * therefore validate versions as semver at the trust boundary before they get
 * here (see the `compat` tool's input schema).
 */
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { getConfig } from '../core/config';

const execFileP = promisify(execFile);

export interface ResolveResult {
  /** True if npm produced a lockfile (the set co-resolves). */
  resolved: boolean;
  /** 'ERESOLVE' when a proven version conflict; null on success. */
  reason: 'ERESOLVE' | null;
  /** npm's own message on a conflict — it names the packages and ranges that
   *  clash, which is strictly better than anything we could paraphrase. */
  detail?: string;
}

// ── Concurrency gate ─────────────────────────────────────────────────────────
// npm holds its arborist tree in memory (200-500MB for a real stack), so
// unbounded parallelism is an OOM, not a speedup. A slot is either held by a
// runner or handed straight to the next waiter — never released into a gap where
// a new caller could claim it as well and push us over the limit.

let active = 0;
const waiting: (() => void)[] = [];

async function acquire(limit: number): Promise<() => void> {
  if (active < limit) active++;
  else await new Promise<void>((resolve) => waiting.push(resolve));

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = waiting.shift();
    if (next) next();
    else active--;
  };
}

/** Pending + running resolves. Exported for the self-check. */
export function inFlight(): { active: number; queued: number } {
  return { active, queued: waiting.length };
}

/**
 * Resolve a package set without installing it. Returns resolved:false only for a
 * *proven* conflict (ERESOLVE); transient failures (network, timeout) throw so
 * the caller treats them as inconclusive and never records a false conflict.
 */
export async function resolveSet(
  specs: { name: string; version: string | null }[],
  opts: { timeoutMs?: number; concurrency?: number; cacheDir?: string } = {},
): Promise<ResolveResult> {
  const config = getConfig();
  const release = await acquire(opts.concurrency ?? config.LURQ_RESOLVE_CONCURRENCY);
  const dir = await mkdtemp(join(tmpdir(), 'lurq-resolve-'));
  try {
    const dependencies: Record<string, string> = {};
    for (const s of specs) dependencies[s.name] = s.version ?? 'latest';
    await writeFile(
      join(dir, 'package.json'),
      // A version is required or npm reports `lurq-resolve@undefined` in its
      // error output, which then reads as if our scaffold were part of the
      // user's stack.
      JSON.stringify({ name: 'lurq-resolve', version: '0.0.0', private: true, dependencies }),
    );
    const args = ['install', '--package-lock-only', '--no-audit', '--no-fund'];
    // A persistent cache is the single highest-leverage setting here: warm, a
    // 15-package stack resolves in 8.6s; cold, 19.2s.
    const cacheDir = opts.cacheDir ?? config.LURQ_NPM_CACHE_DIR;
    if (cacheDir) args.push('--cache', cacheDir);
    // Default (non-legacy) peer resolution is exactly what we want: npm ERESOLVEs
    // on a genuine peer/version conflict instead of silently papering over it.
    await execFileP('npm', args, {
      cwd: dir,
      timeout: opts.timeoutMs ?? config.LURQ_RESOLVE_TIMEOUT_MS,
    });
    return { resolved: true, reason: null };
  } catch (err) {
    const msg = (err as { stderr?: string }).stderr ?? (err as Error).message ?? '';
    if (/ERESOLVE/i.test(msg)) {
      return { resolved: false, reason: 'ERESOLVE', detail: summarizeEresolve(msg) };
    }
    throw err; // network / timeout / other, inconclusive, not a proven conflict
  } finally {
    release();
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Pull the useful part out of npm's ERESOLVE output.
 *
 * npm prints a wall of resolution trace plus advice about --force and
 * --legacy-peer-deps, none of which an agent should act on. The lines that
 * matter say what was found and what was required. Capped because this is
 * stored and returned over the wire.
 */
export function summarizeEresolve(stderr: string, maxChars = 600): string {
  const keep = stderr
    .split('\n')
    .map((l) => l.replace(/^npm (error|ERR!)\s*/, '').trim())
    .filter(
      (l) =>
        l.length > 0 &&
        // Our own scaffold is not part of anyone's stack; naming it in a verdict
        // just invites a reader to go looking for a package that does not exist.
        !l.startsWith('While resolving: lurq-resolve') &&
        /^(While resolving|Found|Could not resolve|Conflicting peer dependency|peer |dependency )/i.test(
          l,
        ),
    );
  const text = (keep.length > 0 ? keep : ['npm could not resolve this set']).join('; ');
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}
