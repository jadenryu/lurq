/**
 * Tier-2 resolve-only compat check (§4C). Ask npm to *resolve* a package set
 * without installing it: `npm install --package-lock-only` builds the lockfile
 * (or fails with ERESOLVE) from registry metadata alone — no tarballs, no build,
 * no VM. This catches the version-conflict class (diamond deps, unsatisfiable
 * peer ranges) that Tier-0 declared analysis can't see, at a fraction of the
 * sandbox's cost. The sandbox (Tier-3) is reserved for runtime proof only.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export interface ResolveResult {
  /** True if npm produced a lockfile (the set co-resolves). */
  resolved: boolean;
  /** 'ERESOLVE' when a proven version conflict; null on success. */
  reason: 'ERESOLVE' | null;
}

/**
 * Resolve a package set without installing it. Returns resolved:false only for a
 * *proven* conflict (ERESOLVE); transient failures (network, timeout) throw so
 * the caller treats them as inconclusive and never records a false conflict.
 */
export async function resolveSet(
  specs: { name: string; version: string | null }[],
  opts: { timeoutMs?: number } = {},
): Promise<ResolveResult> {
  const dir = await mkdtemp(join(tmpdir(), 'lurq-resolve-'));
  try {
    const dependencies: Record<string, string> = {};
    for (const s of specs) dependencies[s.name] = s.version ?? 'latest';
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'lurq-resolve', private: true, dependencies }),
    );
    // Default (non-legacy) peer resolution is exactly what we want: npm ERESOLVEs
    // on a genuine peer/version conflict instead of silently papering over it.
    await execFileP('npm', ['install', '--package-lock-only', '--no-audit', '--no-fund'], {
      cwd: dir,
      timeout: opts.timeoutMs ?? 60_000,
    });
    return { resolved: true, reason: null };
  } catch (err) {
    const msg =
      (err as { stderr?: string }).stderr ?? (err as Error).message ?? '';
    if (/ERESOLVE/i.test(msg)) return { resolved: false, reason: 'ERESOLVE' };
    throw err; // network / timeout / other — inconclusive, not a proven conflict
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
