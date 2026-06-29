/**
 * Local child-process sandbox driver.
 *
 * Installs a package into a throwaway temp dir and smoke-loads it, reporting
 * whether it installs and loads. Fast and dependency-free (just npm + node).
 *
 * NOT an isolation boundary: loading a package executes its top-level code on
 * the host, so use this only for packages you already trust (operator/dev).
 * Verify UNTRUSTED packages with a VM driver. Install scripts stay OFF unless
 * `allowScripts` is set, since the whole point of the security tier is to not
 * execute untrusted install hooks.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  DEFAULT_TARGET,
  type ModuleSystem,
  type Sandbox,
  type SandboxResult,
  type SandboxVerifyOptions,
} from './types';

const execFileAsync = promisify(execFile);
const INSTALL_TIMEOUT_MS = 120_000;
const SMOKE_TIMEOUT_MS = 30_000;
const ERROR_MAX = 500;

/** npm args for a throwaway install into the sandbox dir. */
export function npmInstallArgs(spec: string, opts: { allowScripts: boolean }): string[] {
  const args = ['install', spec, '--no-audit', '--no-fund', '--no-package-lock', '--no-save'];
  if (!opts.allowScripts) args.push('--ignore-scripts');
  return args;
}

/** A one-liner that loads the package and exits non-zero if it throws. */
export function smokeScript(pkg: string, moduleSystem: ModuleSystem): string[] {
  return moduleSystem === 'esm'
    ? ['--input-type=module', '-e', `await import(${JSON.stringify(pkg)})`]
    : ['-e', `require(${JSON.stringify(pkg)})`];
}

function condense(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, ERROR_MAX);
}

function stderrOf(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { stderr?: unknown; message?: unknown };
    if (typeof e.stderr === 'string' && e.stderr.trim()) return e.stderr;
    if (typeof e.message === 'string') return e.message;
  }
  return String(err);
}

export class LocalSandbox implements Sandbox {
  readonly name = 'local';

  async verify(
    pkg: string,
    version: string | null,
    opts: SandboxVerifyOptions = {},
  ): Promise<SandboxResult> {
    const target = opts.target ?? DEFAULT_TARGET;
    const allowScripts = opts.allowScripts ?? false;
    const spec = version ? `${pkg}@${version}` : pkg;
    const dir = await mkdtemp(join(tmpdir(), 'lurq-sandbox-'));
    const started = Date.now();
    let installed = false;
    let imported: boolean | null = null;
    let error: string | null = null;

    try {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'lurq-sandbox', version: '0.0.0', private: true }),
      );
      await execFileAsync('npm', npmInstallArgs(spec, { allowScripts }), {
        cwd: dir,
        timeout: opts.timeoutMs ?? INSTALL_TIMEOUT_MS,
        signal: opts.signal,
      });
      installed = true;

      try {
        await execFileAsync('node', smokeScript(pkg, target.moduleSystem), {
          cwd: dir,
          timeout: SMOKE_TIMEOUT_MS,
          signal: opts.signal,
        });
        imported = true;
      } catch (err) {
        imported = false;
        error = condense(stderrOf(err));
      }
    } catch (err) {
      error = condense(stderrOf(err));
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }

    return {
      driver: this.name,
      moduleSystem: target.moduleSystem,
      installed,
      imported,
      ranScripts: allowScripts,
      durationMs: Date.now() - started,
      error,
    };
  }
}
